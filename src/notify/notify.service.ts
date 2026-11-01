import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { SettingsService } from '../settings/settings.service';
import { OutboxService } from './outbox.service';
import {
  NotifyConfig,
  TEMPLATES,
  alertLine,
  clock,
  firstName,
  money,
  normalizeNotify,
  statusLine,
  toE164India,
} from './notify.config';

/**
 * NotifyService — business events → WhatsApp messages (via the outbox).
 *
 * Customers: order placed, cooking, on the way, delivered, cancelled,
 *            running late, late make-good.
 * Staff:     new order, not accepted in N min, ready with no carrier for
 *            N min, book Porter now, running late.
 *
 * Every method is fire-and-forget safe: it never throws into the order flow.
 * Every message has a dedupe key, so retries and repeated ticks send once.
 */
@Injectable()
export class NotifyService {
  private readonly logger = new Logger(NotifyService.name);

  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    private readonly settings: SettingsService,
    private readonly outbox: OutboxService,
  ) {}

  async config(): Promise<{ cfg: NotifyConfig; tz: string }> {
    const s: any = await this.settings.get();
    return {
      cfg: normalizeNotify(s.notifyConfig),
      tz: s.timezone || 'Asia/Kolkata',
    };
  }

  /** Public site, for tracking links. PUBLIC_SITE_URL, else the first CORS origin. */
  static siteUrl(): string {
    const env =
      process.env.PUBLIC_SITE_URL ||
      (process.env.CORS_ORIGINS || '').split(',')[0] ||
      '';
    return env.trim().replace(/\/+$/, '') || 'https://bitetheory.in';
  }
  static trackUrl(orderId: number) {
    return `${NotifyService.siteUrl()}/orders/${orderId}`;
  }
  static adminUrl() {
    return `${NotifyService.siteUrl()}/admin#live_orders`;
  }

  private async order(orderId: number) {
    const [o] = await this.ds.query(
      `SELECT o.id, o.order_number, o.total, o.status, o.user_id, o.promised_at, o.promised_min, o.promised_max,
              o.delivery_address, o.delivery_provider, o.external_tracking_url, o.delivery_partner_id,
              o.fulfillment, o.delivery_otp, po.name AS pickup_outlet,
              u.first_name, u.mobile, COALESCE(u.whatsapp_opt_out, false) AS opt_out,
              dp.name AS rider_name,
              (SELECT COUNT(*) FROM order_items i WHERE i.order_id = o.id)::int AS items
         FROM orders o
         LEFT JOIN users u ON u.id = o.user_id
         LEFT JOIN delivery_partners dp ON dp.id = o.delivery_partner_id
         LEFT JOIN outlets po ON po.id = o.pickup_outlet_id
        WHERE o.id = $1`,
      [orderId],
    );
    return o || null;
  }

  private async toCustomer(
    o: any,
    kind: string,
    template: keyof typeof TEMPLATES,
    params: string[],
    dedupe: string,
  ) {
    const to = toE164India(o?.mobile);
    if (!to || o.opt_out) return false;
    return this.outbox.enqueue({
      audience: 'customer',
      to,
      template: TEMPLATES[template].name,
      params,
      orderId: Number(o.id),
      kind,
      dedupeKey: dedupe,
    });
  }

  private async toStaff(
    cfg: NotifyConfig,
    orderId: number,
    orderNumber: string,
    kind: string,
    line: string,
    dedupe: string,
  ) {
    if (!cfg.staffEnabled || !cfg.staffPhones.length) return 0;
    let n = 0;
    for (const to of cfg.staffPhones) {
      const ok = await this.outbox.enqueue({
        audience: 'staff',
        to,
        template: TEMPLATES.kitchenAlert.name,
        params: [orderNumber, line, NotifyService.adminUrl()],
        orderId,
        kind: `alert:${kind}`,
        dedupeKey: `${dedupe}:${to}`,
      });
      if (ok) n++;
    }
    return n;
  }

  /* ─────────────────────────── customer ─────────────────────────── */

  async orderPlaced(orderId: number) {
    try {
      const { cfg, tz } = await this.config();
      const o = await this.order(orderId);
      if (!o) return;
      if (cfg.customerEnabled) {
        const pickup = o.fulfillment === 'pickup';
        const eta = pickup
          ? `takeaway, ready for pickup at ${o.pickup_outlet || 'the outlet'}${o.promised_at ? ` around ${clock(new Date(o.promised_at), tz)}` : ''}. Pickup code ${o.delivery_otp}`
          : o.promised_min && o.promised_max
            ? `${o.promised_min}-${o.promised_max} min (by ${clock(new Date(o.promised_at), tz)})`
            : 'about 30-45 min';
        await this.toCustomer(
          o,
          'order_placed',
          'orderPlaced',
          [
            firstName(o.first_name),
            o.order_number,
            money(Number(o.total)),
            eta,
            NotifyService.trackUrl(o.id),
          ],
          `order_placed:${o.id}`,
        );
      }
      if (cfg.alertNewOrder) {
        const { localityHint } = NotifyService;
        await this.toStaff(
          cfg,
          o.id,
          o.order_number,
          'new_order',
          alertLine('new_order', {
            total: Number(o.total),
            items: o.items,
            area: o.fulfillment === 'pickup'
              ? `TAKEAWAY at ${o.pickup_outlet || 'outlet'}`
              : localityHint(o.delivery_address),
          }),
          `alert:new_order:${o.id}`,
        );
      }
    } catch (e) {
      this.warn('orderPlaced', e);
    }
  }

  async statusChanged(orderId: number, status: string) {
    try {
      const { cfg } = await this.config();
      if (!cfg.customerEnabled) return;
      const o = await this.order(orderId);
      if (!o) return;
      const line = statusLine(status, {
        riderName: o.rider_name,
        porter: o.delivery_provider && o.delivery_provider !== 'in_house',
        porterLink: o.external_tracking_url,
        cooking: cfg.customerCooking,
        pickupAt: o.fulfillment === 'pickup' ? (o.pickup_outlet || 'the outlet') : null,
        pickupCode: o.fulfillment === 'pickup' ? o.delivery_otp : null,
      });
      if (!line) return;
      await this.toCustomer(
        o,
        `status:${status}`,
        'orderUpdate',
        [
          firstName(o.first_name),
          o.order_number,
          line,
          NotifyService.trackUrl(o.id),
        ],
        `status:${o.id}:${status}`,
      );
    } catch (e) {
      this.warn('statusChanged', e);
    }
  }

  async delayed(orderId: number, liveAt: Date) {
    try {
      const { cfg, tz } = await this.config();
      const o = await this.order(orderId);
      if (!o) return;
      const when = clock(liveAt, tz);
      if (cfg.customerEnabled) {
        await this.toCustomer(
          o,
          'delayed',
          'orderDelayed',
          [firstName(o.first_name), o.order_number, when],
          `delayed:${o.id}`,
        );
      }
      if (cfg.alertRunningLate) {
        await this.toStaff(
          cfg,
          o.id,
          o.order_number,
          'running_late',
          alertLine('running_late', { when }),
          `alert:late:${o.id}`,
        );
      }
    } catch (e) {
      this.warn('delayed', e);
    }
  }

  async madeGood(orderId: number, amount: number, lateByMin: number) {
    try {
      const { cfg } = await this.config();
      if (!cfg.customerEnabled) return;
      const o = await this.order(orderId);
      if (!o) return;
      await this.toCustomer(
        o,
        'makegood',
        'orderUpdate',
        [
          firstName(o.first_name),
          o.order_number,
          `it reached you ${lateByMin} min later than we promised, so we have added ₹${money(amount)} to your Bite Theory wallet. Sorry`,
          NotifyService.trackUrl(o.id),
        ],
        `makegood:${o.id}`,
      );
    } catch (e) {
      this.warn('madeGood', e);
    }
  }

  /* ─────────────────────────── staff watch (every dispatch tick) ─────────────────────────── */

  /** Orders waiting too long for Accept, and food ready too long with nobody carrying it. */
  async watch(): Promise<number> {
    const { cfg } = await this.config();
    if (!cfg.staffEnabled || !cfg.staffPhones.length) return 0;
    let n = 0;
    if (cfg.notAcceptedMin > 0) {
      const rows = await this.ds.query(
        `SELECT id, order_number, EXTRACT(EPOCH FROM (now() - placed_at::timestamptz)) / 60 AS mins
           FROM orders WHERE status = 'order_received'
            AND placed_at::timestamptz < now() - make_interval(mins => $1::int)
            AND placed_at::timestamptz > now() - interval '6 hours'`,
        [cfg.notAcceptedMin],
      );
      for (const r of rows) {
        n += await this.toStaff(
          cfg,
          Number(r.id),
          r.order_number,
          'not_accepted',
          alertLine('not_accepted', { minutes: Math.round(Number(r.mins)) }),
          `alert:not_accepted:${r.id}`,
        );
      }
    }
    if (cfg.readyNoCarrierMin > 0) {
      const rows = await this.ds.query(
        `SELECT id, order_number, EXTRACT(EPOCH FROM (now() - ready_at)) / 60 AS mins
           FROM orders WHERE status = 'food_ready' AND ready_at IS NOT NULL
            AND COALESCE(fulfillment, 'delivery') = 'delivery'
            AND delivery_partner_id IS NULL AND COALESCE(delivery_provider, 'in_house') = 'in_house'
            AND ready_at < now() - make_interval(mins => $1::int)
            AND ready_at > now() - interval '6 hours'`,
        [cfg.readyNoCarrierMin],
      );
      for (const r of rows) {
        n += await this.toStaff(
          cfg,
          Number(r.id),
          r.order_number,
          'ready_no_carrier',
          alertLine('ready_no_carrier', {
            minutes: Math.round(Number(r.mins)),
          }),
          `alert:ready:${r.id}`,
        );
      }
    }
    return n;
  }

  /** The planner says "book Porter now" for these orders. */
  async bookPorterNow(
    orders: { orderId: number; orderNumber: string }[],
  ): Promise<number> {
    const { cfg } = await this.config();
    if (!cfg.alertBookPorter) return 0;
    let n = 0;
    for (const o of orders) {
      n += await this.toStaff(
        cfg,
        o.orderId,
        o.orderNumber,
        'book_porter',
        alertLine('book_porter', {}),
        `alert:porter:${o.orderId}`,
      );
    }
    return n;
  }

  /** Admin "Send test": proves token, number and template all work. */
  async test(
    phone: string,
  ): Promise<{ ok: boolean; to?: string; error?: string }> {
    const to = toE164India(phone);
    if (!to)
      return {
        ok: false,
        error: "That doesn't look like a valid mobile number.",
      };
    await this.outbox.enqueue({
      audience: 'staff',
      to,
      template: TEMPLATES.kitchenAlert.name,
      params: [
        'TEST',
        'this is a test message from your Bite Theory admin',
        NotifyService.adminUrl(),
      ],
      kind: 'test',
      dedupeKey: `test:${to}:${Date.now()}`,
    });
    await this.outbox.flush();
    return { ok: true, to };
  }

  /**
   * The area from a free-text address, for the kitchen alert: the part just
   * before the city ("12, Scheme No 78, Vijay Nagar, Indore, Near C21 Mall"
   * → "Vijay Nagar"), skipping landmarks, pincodes and house numbers.
   */
  static localityHint(addr?: string | null): string | null {
    if (!addr) return null;
    const parts = String(addr)
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean);
    const city = /^(indore|ujjain|bhopal|dewas|mhow)(\s*[-–]?\s*\d{6})?$/i; // "Indore 452009" too
    const noise = (p: string) =>
      city.test(p) ||
      /^(madhya pradesh|mp|india)$/i.test(p) ||
      /^\d/.test(p) ||
      /^(near|opp\.?|opposite|behind|beside|next to)\b/i.test(p);
    const at = parts.findIndex((p) => city.test(p));
    if (at > 0 && !noise(parts[at - 1])) return parts[at - 1].slice(0, 40);
    const useful = parts.filter((p) => !noise(p));
    return useful.length ? useful[useful.length - 1].slice(0, 40) : null;
  }

  private warn(what: string, e: unknown) {
    this.logger.warn(
      `WhatsApp ${what} skipped: ${e instanceof Error ? e.message : e}`,
    );
  }
}
