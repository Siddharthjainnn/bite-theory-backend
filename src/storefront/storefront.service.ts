import {
  BadRequestException,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { SettingsService } from '../settings/settings.service';
import { OutboxService } from '../notify/outbox.service';
import { NotifyService } from '../notify/notify.service';
import { returned } from '../common/sql.util';
import { TEMPLATES, firstName, toE164India } from '../notify/notify.config';
import {
  SEND_WINDOW_MS,
  StorefrontConfig,
  launchPhase,
  normalizeStorefront,
} from './storefront.config';

const mask = (p: string) =>
  String(p).replace(
    /^(\d{2})(\d+)(\d{4})$/,
    (_x, a: string, mid: string, b: string) =>
      `+${a} ${'•'.repeat(mid.length)}${b}`,
  );

/**
 * StorefrontService — the launch "Notify me" list and its opening-day WhatsApp.
 *
 * The list is plain rows (unique by phone). At the opening time a 60-second
 * check claims un-notified rows (FOR UPDATE SKIP LOCKED, so two API instances
 * never both claim one) and queues one WhatsApp each through the outbox,
 * whose dedupe key makes a second send impossible anyway.
 */
@Injectable()
export class StorefrontService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(StorefrontService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    private readonly settings: SettingsService,
    private readonly outbox: OutboxService,
  ) {}

  onModuleInit() {
    if (process.env.NODE_ENV === 'test' || process.env.LAUNCH_SENDER === 'off')
      return;
    this.timer = setInterval(() => {
      void this.sendOpeningDay();
    }, 60_000);
    this.timer.unref?.();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async config(): Promise<StorefrontConfig> {
    return normalizeStorefront((await this.settings.get()).storefrontConfig);
  }

  /** Customer taps "Notify me". Signed in → their profile mobile; else the phone they typed. */
  async subscribe(
    body: { phone?: unknown; name?: unknown },
    uid: number | null,
  ): Promise<{ ok: true; phone: string; already: boolean }> {
    let phone = typeof body?.phone === 'string' ? body.phone : '';
    let name =
      typeof body?.name === 'string' ? body.name.trim().slice(0, 80) : '';
    if (uid) {
      const [u] = await this.ds.query(
        `SELECT first_name, mobile FROM users WHERE id = $1`,
        [uid],
      );
      if (u) {
        phone = phone || u.mobile || '';
        name = name || u.first_name || '';
      }
    }
    const to = toE164India(phone);
    if (!to)
      throw new BadRequestException(
        'Please enter a valid 10-digit mobile number.',
      );
    const [row] = await this.ds.query(
      `INSERT INTO launch_subscribers (phone, name, user_id)
       VALUES ($1, NULLIF($2, ''), $3)
       ON CONFLICT (phone) DO UPDATE
         SET name = COALESCE(launch_subscribers.name, EXCLUDED.name),
             user_id = COALESCE(launch_subscribers.user_id, EXCLUDED.user_id)
       RETURNING (xmax = 0) AS created`,
      [to, name, uid],
    );
    return { ok: true, phone: mask(to), already: !row?.created };
  }

  async stats() {
    const [c] = await this.ds.query(
      `SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE notified_at IS NOT NULL)::int AS notified,
              COUNT(*) FILTER (WHERE created_at > now() - interval '24 hours')::int AS today
         FROM launch_subscribers`,
    );
    const recent = await this.ds.query(
      `SELECT phone, name, created_at FROM launch_subscribers ORDER BY id DESC LIMIT 20`,
    );
    return {
      ...c,
      recent: recent.map((r: any) => ({ ...r, phone: mask(r.phone) })),
    };
  }

  async csv(): Promise<string> {
    const rows = await this.ds.query(
      `SELECT phone, COALESCE(name, '') AS name, created_at, notified_at
         FROM launch_subscribers ORDER BY id`,
    );
    const q = (v: unknown) => {
      const s = v instanceof Date ? v.toISOString() : String(v ?? '');
      /* a leading = + - @ turns into a formula in Excel: neutralise it */
      const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
      return `"${safe.replace(/"/g, '""')}"`;
    };
    return [
      'phone,name,signed_up_at,notified_at',
      ...rows.map((r: any) =>
        [r.phone, r.name, r.created_at, r.notified_at || ''].map(q).join(','),
      ),
    ].join('\n');
  }

  /** At opening time: one WhatsApp per person on the list. Safe to call any time. */
  async sendOpeningDay(now = Date.now()): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    let queued = 0;
    try {
      const { launch } = await this.config();
      if (!launch.autoNotify || launchPhase(launch, now) !== 'open') return 0;
      if (now - Date.parse(launch.opensAt) > SEND_WINDOW_MS) return 0;
      const where = [launch.area, launch.city].filter(Boolean).join(', ');
      for (;;) {
        const batch = returned(
          await this.ds.query(
            `UPDATE launch_subscribers SET notified_at = now()
              WHERE id IN (SELECT id FROM launch_subscribers WHERE notified_at IS NULL
                            ORDER BY id LIMIT 200 FOR UPDATE SKIP LOCKED)
            RETURNING phone, name`,
          ),
        );
        if (!batch.length) break;
        const optedOut = new Set<string>(
          (
            await this.ds.query(
              `SELECT RIGHT(regexp_replace(COALESCE(mobile, ''), '\\D', '', 'g'), 10) AS m
                 FROM users WHERE whatsapp_opt_out = true`,
            )
          ).map((r: any) => r.m),
        );
        for (const r of batch) {
          if (optedOut.has(String(r.phone).slice(-10))) continue;
          const ok = await this.outbox.enqueue({
            audience: 'customer',
            to: r.phone,
            template: TEMPLATES.outletOpen.name,
            params: [firstName(r.name), where, NotifyService.siteUrl()],
            kind: 'launch_open',
            dedupeKey: `launch_open:${r.phone}`,
          });
          if (ok) queued++;
        }
      }
      if (queued)
        this.logger.log(`Opening day: queued ${queued} WhatsApp message(s).`);
    } catch (e: unknown) {
      this.logger.warn(
        `Opening-day send skipped: ${e instanceof Error ? e.message : e}`,
      );
    } finally {
      this.running = false;
    }
    return queued;
  }
}
