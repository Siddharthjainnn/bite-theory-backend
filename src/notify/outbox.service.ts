import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { returned } from '../common/sql.util';
import { WhatsAppService } from './whatsapp.service';
import {
  MAX_ATTEMPTS,
  RETRY_MINUTES,
  cleanParam,
  isPermanentError,
} from './notify.config';

export interface OutboxMessage {
  audience: 'customer' | 'staff';
  to: string; // E.164 digits
  template: string; // approved template name, or '_text' for a free-form reply
  params: string[];
  orderId?: number | null;
  kind: string;
  dedupeKey: string;
}

/** Free-form text inside the 24 h window (e.g. confirming STOP). */
export const TEXT = '_text';

/**
 * OutboxService — every WhatsApp message is a row first, a send second.
 *
 * Why an outbox: the order flow must never wait on (or fail because of)
 * WhatsApp. Business code only INSERTs; this service delivers in the
 * background, retries with backoff, never sends a dedupe_key twice, and
 * tracks Meta's delivery receipts. Several API instances can run it at once:
 * rows are claimed with FOR UPDATE SKIP LOCKED, so each is sent exactly once.
 */
@Injectable()
export class OutboxService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OutboxService.name);
  private timer: NodeJS.Timeout | null = null;
  private flushing = false;
  private again = false;

  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    private readonly wa: WhatsAppService,
  ) {}

  onModuleInit() {
    if (process.env.NODE_ENV === 'test' || process.env.NOTIFY_SENDER === 'off')
      return;
    this.timer = setInterval(() => {
      void this.flush();
    }, 15_000);
    this.timer.unref?.();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  /** Queue a message. Same dedupe key twice → stored once. Never throws. */
  async enqueue(m: OutboxMessage): Promise<boolean> {
    try {
      const rows = await this.ds.query(
        `INSERT INTO notification_outbox (audience, to_phone, template, params, order_id, kind, dedupe_key)
         VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7)
         ON CONFLICT (dedupe_key) DO NOTHING RETURNING id`,
        [
          m.audience,
          m.to,
          m.template,
          JSON.stringify(m.params.map((p) => cleanParam(p))),
          m.orderId ?? null,
          m.kind,
          m.dedupeKey.slice(0, 160),
        ],
      );
      if (rows.length) this.flushSoon();
      return rows.length > 0;
    } catch (e: unknown) {
      this.logger.warn(
        `Could not queue WhatsApp ${m.kind}: ${e instanceof Error ? e.message : e}`,
      );
      return false;
    }
  }

  /** Send now-ish without blocking the caller; coalesces bursts. */
  flushSoon() {
    if (process.env.NOTIFY_SENDER === 'off') return;
    setImmediate(() => {
      void this.flush();
    });
  }

  /** Deliver everything that is due. Returns how many were attempted. */
  async flush(): Promise<number> {
    if (this.flushing) {
      this.again = true;
      return 0;
    }
    this.flushing = true;
    let attempted = 0;
    try {
      /* a send that crashed mid-flight (deploy, OOM) goes back in the queue */
      await this.ds.query(
        `UPDATE notification_outbox SET status = 'pending', updated_at = now()
          WHERE status = 'sending' AND updated_at < now() - interval '5 minutes'`,
      );
      for (;;) {
        const batch = returned(
          await this.ds.query(
            `UPDATE notification_outbox SET status = 'sending', attempts = attempts + 1, updated_at = now()
            WHERE id IN (SELECT id FROM notification_outbox
                          WHERE status = 'pending' AND next_try_at <= now()
                          ORDER BY id LIMIT 20 FOR UPDATE SKIP LOCKED)
          RETURNING id, to_phone, template, params, attempts, kind`,
          ),
        );
        if (!batch.length) break;
        for (const row of batch) {
          attempted++;
          await this.deliver(row);
        }
      }
    } catch (e: unknown) {
      this.logger.warn(
        `WhatsApp flush failed: ${e instanceof Error ? e.message : e}`,
      );
    } finally {
      this.flushing = false;
      if (this.again) {
        this.again = false;
        this.flushSoon();
      }
    }
    return attempted;
  }

  private async deliver(row: any) {
    if (!this.wa.configured) {
      await this.ds.query(
        `UPDATE notification_outbox SET status = 'skipped', last_error = $2, updated_at = now() WHERE id = $1`,
        [
          row.id,
          'WhatsApp is not configured on the server (WHATSAPP_TOKEN / WHATSAPP_PHONE_NUMBER_ID).',
        ],
      );
      return;
    }
    const params: string[] = Array.isArray(row.params) ? row.params : [];
    const res =
      row.template === TEXT
        ? await this.wa.sendText(row.to_phone, params[0] || '')
        : await this.wa.sendTemplate(row.to_phone, row.template, params);

    if (res.ok) {
      await this.ds.query(
        `UPDATE notification_outbox SET status = 'sent', provider_id = $2, sent_at = now(), last_error = NULL, updated_at = now()
          WHERE id = $1`,
        [row.id, res.id],
      );
      return;
    }
    const attempts = Number(row.attempts);
    const giveUp = isPermanentError(res.code) || attempts >= MAX_ATTEMPTS;
    const err = `${res.code ? `[${res.code}] ` : ''}${res.error || 'send failed'}`;
    if (giveUp) {
      await this.ds.query(
        `UPDATE notification_outbox SET status = 'failed', last_error = $2, updated_at = now() WHERE id = $1`,
        [row.id, err],
      );
      this.logger.warn(
        `WhatsApp ${row.kind} to …${String(row.to_phone).slice(-4)} failed for good: ${err}`,
      );
    } else {
      const wait =
        RETRY_MINUTES[Math.min(attempts - 1, RETRY_MINUTES.length - 1)];
      await this.ds.query(
        `UPDATE notification_outbox
            SET status = 'pending', last_error = $2, next_try_at = now() + make_interval(secs => $3), updated_at = now()
          WHERE id = $1`,
        [row.id, err, Math.round(wait * 60)],
      );
    }
  }

  /* ─────────────────────────── webhook ─────────────────────────── */

  /**
   * Meta's webhook: delivery receipts (sent → delivered → read, or failed)
   * and inbound messages (STOP / START). Statuses only move forward, since
   * Meta can deliver receipts out of order.
   */
  async handleWebhook(body: any) {
    const RANK: Record<string, number> = {
      sent: 1,
      delivered: 2,
      read: 3,
      failed: 4,
    };
    let statuses = 0,
      inbound = 0;
    for (const entry of body?.entry || []) {
      for (const change of entry?.changes || []) {
        const v = change?.value || {};
        for (const s of v.statuses || []) {
          if (!s?.id || !RANK[s.status]) continue;
          const err =
            s.status === 'failed' && s.errors?.[0]
              ? `[${s.errors[0].code}] ${s.errors[0].title || s.errors[0].message || 'failed'}`
              : null;
          await this.ds.query(
            `UPDATE notification_outbox
                SET status = $2, last_error = COALESCE($3, last_error), updated_at = now()
              WHERE provider_id = $1
                AND COALESCE(array_position(ARRAY['sent','delivered','read','failed'], status), 0) < $4`,
            [String(s.id), s.status, err, RANK[s.status]],
          );
          statuses++;
        }
        for (const m of v.messages || []) {
          const from = String(m?.from || '');
          const text = String(m?.text?.body || m?.button?.text || '')
            .trim()
            .toUpperCase();
          if (!from || !text) continue;
          inbound++;
          if (['STOP', 'UNSUBSCRIBE', 'STOP ALL', 'BAND KARO'].includes(text)) {
            await this.setOptOut(from, true);
            await this.enqueue({
              audience: 'customer',
              to: from,
              template: TEXT,
              kind: 'opt_out_ack',
              params: [
                'You will no longer get Bite Theory order updates on WhatsApp. Reply START to turn them back on.',
              ],
              dedupeKey: `optout:${from}:${m.id || Date.now()}`,
            });
          } else if (['START', 'SUBSCRIBE'].includes(text)) {
            await this.setOptOut(from, false);
            await this.enqueue({
              audience: 'customer',
              to: from,
              template: TEXT,
              kind: 'opt_in_ack',
              params: [
                'Done! You will get your Bite Theory order updates on WhatsApp again.',
              ],
              dedupeKey: `optin:${from}:${m.id || Date.now()}`,
            });
          }
        }
      }
    }
    return { ok: true, statuses, inbound };
  }

  /** users.mobile is stored in mixed formats; match on the last 10 digits. */
  private async setOptOut(e164: string, optOut: boolean) {
    const last10 = e164.replace(/\D/g, '').slice(-10);
    await this.ds.query(
      `UPDATE users SET whatsapp_opt_out = $2
        WHERE RIGHT(regexp_replace(COALESCE(mobile, ''), '\\D', '', 'g'), 10) = $1`,
      [last10, optOut],
    );
  }

  /** Recent messages for the admin log (phones masked). */
  async recent(limit = 50) {
    const rows = await this.ds.query(
      `SELECT o.id, o.audience, o.to_phone, o.template, o.kind, o.status, o.attempts, o.last_error,
              o.order_id, ord.order_number, o.created_at, o.sent_at, o.updated_at
         FROM notification_outbox o LEFT JOIN orders ord ON ord.id = o.order_id
        ORDER BY o.id DESC LIMIT $1`,
      [Math.min(200, Math.max(1, limit))],
    );
    return rows.map((r: any) => ({
      ...r,
      to_phone: String(r.to_phone).replace(
        /^(\d{2})(\d+)(\d{4})$/,
        (_x: string, a: string, mid: string, b: string) =>
          `+${a} ${'•'.repeat(mid.length)}${b}`,
      ),
    }));
  }

  async counts() {
    const [r] = await this.ds.query(
      `SELECT COUNT(*) FILTER (WHERE created_at > now() - interval '24 hours')::int AS day,
              COUNT(*) FILTER (WHERE created_at > now() - interval '24 hours' AND status IN ('sent','delivered','read'))::int AS ok,
              COUNT(*) FILTER (WHERE created_at > now() - interval '24 hours' AND status = 'failed')::int AS failed,
              COUNT(*) FILTER (WHERE status = 'pending')::int AS pending
         FROM notification_outbox`,
    );
    return r;
  }
}
