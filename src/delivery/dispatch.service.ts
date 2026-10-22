import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { OrdersService } from '../orders/orders.service';
import { MailService } from '../common/mail.service';
import { EtaService } from './eta.service';
import { TripsService, RiderStatus } from './trips.service';
import {
  PoolOrder,
  bestRoute,
  driveMin,
  formTrips,
  hourBand,
  isDelayed,
  porterBookAt,
  rankRiders,
  riderLateMin,
} from './dispatch.algo';
import { returned } from '../common/sql.util';

const MIN = 60_000;

export type SuggestionKind = 'join' | 'trip' | 'rider' | 'porter' | 'no_pin';

export interface Suggestion {
  orderId: number;
  orderNumber: string;
  kind: SuggestionKind;
  reason: string;
  readyAt: string;
  readyInMin: number;
  riderId?: number;
  riderName?: string;
  riderLabel?: string;
  riderLateMin?: number;
  tripId?: number; // join: the open trip to add to
  tripOrderIds?: number[]; // trip: every order in the proposed trip, drop order
  tripOrderNumbers?: string[];
  savingMin?: number;
  extraWaitMin?: number; // this order's extra wait vs going alone
  porterBookAt?: string;
  porterBookInMin?: number;
}

/**
 * DispatchService — "who carries each order" (PRD: Dispatch) plus the
 * background loop that keeps promises: delay apologies, auto-dispatch, and
 * the nightly model rebuild.
 *
 * Preference, cheapest first: join a trip already forming → a new shared trip
 * → one own rider → Porter. Our own rider must be at the kitchen within a few
 * minutes of the food being ready; otherwise Porter, booked so its driver
 * arrives as the bag is sealed.
 */
@Injectable()
export class DispatchService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DispatchService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  /** Shared lock id, so only ONE API instance runs the loop at a time. */
  private static readonly LOCK = 7_244_001;
  static readonly TICK_MS = 30_000;

  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    private readonly orders: OrdersService,
    private readonly trips: TripsService,
    private readonly eta: EtaService,
    private readonly mail: MailService,
  ) {}

  onModuleInit() {
    if (
      process.env.NODE_ENV === 'test' ||
      process.env.DISPATCH_TICKER === 'off'
    )
      return;
    this.timer = setInterval(() => {
      void this.tick();
    }, DispatchService.TICK_MS);
    this.timer.unref?.();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  /* ─────────────────────────── suggestions ─────────────────────────── */

  async suggestions(now = Date.now()): Promise<{
    generatedAt: string;
    suggestions: Suggestion[];
    riders: RiderStatus[];
  }> {
    const { cfg, settings } = await this.eta.config();
    const store = await this.trips.store();
    const mpk = await this.eta.minPerKm(new Date(now));
    const stats = await this.eta.statsFor(
      hourBand(new Date(now), settings.timezone || 'Asia/Kolkata'),
    );
    const riders = await this.trips.riders(now);

    /* The pool: accepted, in-house, nobody carrying it yet. */
    const waiting = await this.ds.query(
      `SELECT id FROM orders
        WHERE status IN ('order_confirmed','preparing_food','food_ready')
          AND COALESCE(delivery_provider, 'in_house') = 'in_house'
          AND delivery_partner_id IS NULL AND trip_id IS NULL
        ORDER BY placed_at`,
    );
    const all = await this.trips.poolOrders(
      waiting.map((w: any) => Number(w.id)),
      now,
    );
    const out: Suggestion[] = [];
    const base = (p: PoolOrder & { row: any }) => ({
      orderId: p.orderId,
      orderNumber: p.row.order_number,
      readyAt: new Date(p.readyAt).toISOString(),
      readyInMin: Math.max(0, Math.round((p.readyAt - now) / MIN)),
    });

    const pinned = all.filter(
      (p) => Number.isFinite(p.dest.lat) && Number.isFinite(p.dest.lng),
    );
    for (const p of all.filter((x) => !pinned.includes(x))) {
      out.push({
        ...base(p),
        kind: 'no_pin',
        reason:
          'No map pin on this address. Call the customer, then assign by hand.',
      });
    }
    if (!store) {
      for (const p of pinned)
        out.push({
          ...base(p),
          kind: 'no_pin',
          reason: 'Set the kitchen pin in Settings → Store to get suggestions.',
        });
      return {
        generatedAt: new Date(now).toISOString(),
        suggestions: out,
        riders,
      };
    }

    /* 1) Join a planned trip that still has room. */
    let pool = [...pinned];
    const open = (await this.trips.openTrips()).filter(
      (t) => t.status === 'planned',
    );
    for (const t of open) {
      const r = riders.find((x) => x.id === t.riderId);
      if (!r || t.stops.length >= r.capacity) continue;
      const seed = await this.trips.poolOrders(
        t.stops.map((s) => s.orderId),
        now,
      );
      const seedPlan = bestRoute(seed, store, mpk, {
        ...cfg,
        batchMaxExtraMin: 1e9,
        batchReadyGapMin: 1e9,
        foodAgeMaxMin: 1e9,
        batchMaxDropGapKm: 0,
        batchMaxBearingDeg: 180,
      });
      let best: {
        p: (typeof pool)[number];
        saving: number;
        extra: number;
      } | null = null;
      for (const cand of pool) {
        const plan = bestRoute([...seed, cand], store, mpk, cfg);
        if (!plan || !seedPlan) continue;
        /* saving = the candidate's own round trip − what it adds to this trip */
        const ownTrip = 2 * driveMin(store, cand.dest, mpk);
        const saving = ownTrip - (plan.tripMinutes - seedPlan.tripMinutes);
        const k = plan.orderIds.indexOf(cand.orderId);
        if (saving > 0.5 && (!best || saving > best.saving))
          best = { p: cand, saving, extra: plan.extraWaitMin[k] };
      }
      if (best) {
        out.push({
          ...base(best.p),
          kind: 'join',
          tripId: t.id,
          riderId: r.id,
          riderName: r.name,
          riderLabel: r.label,
          savingMin: Math.round(best.saving),
          extraWaitMin: Math.round(best.extra),
          reason: `Fits ${r.name}'s trip (${t.stops.map((s) => s.orderNumber).join(', ')}); saves ~${Math.round(best.saving)} min of riding.`,
        });
        pool = pool.filter((x) => x !== best!.p);
      }
    }

    /* 2) Shared trips for the rest, then a rider (or Porter) for each. */
    const plans = formTrips(pool, store, mpk, cfg).sort(
      (a, b) => a.departAt - b.departAt,
    );
    const taken = new Set<number>();
    for (const plan of plans) {
      const members = plan.orderIds.map(
        (id) => pool.find((p) => p.orderId === id)!,
      );
      const cod = members.reduce((s, m) => s + m.codAmount, 0);
      const ranked = rankRiders(
        riders.filter((r) => !taken.has(r.id) && r.capacity >= members.length),
        plan.departAt,
        cod,
        now,
      );
      const rider = ranked[0];
      const late = rider ? riderLateMin(rider, plan.departAt, now) : Infinity;

      if (rider && late <= cfg.batchReadyGapMin) {
        taken.add(rider.id);
        const shared = members.length > 1;
        members.forEach((m, k) =>
          out.push({
            ...base(m),
            kind: shared ? 'trip' : 'rider',
            riderId: rider.id,
            riderName: rider.name,
            riderLabel: rider.label,
            riderLateMin: Math.round(late),
            ...(shared
              ? {
                  tripOrderIds: plan.orderIds,
                  tripOrderNumbers: members.map((x) => x.row.order_number),
                  savingMin: Math.round(plan.savingMinutes),
                  extraWaitMin: Math.round(plan.extraWaitMin[k]),
                }
              : {}),
            reason: shared
              ? `Send ${members.map((x) => x.row.order_number).join(' + ')} together with ${rider.name}; saves ~${Math.round(plan.savingMinutes)} min.`
              : late > 0
                ? `${rider.name} (${rider.label.toLowerCase()}) is the best fit; food waits ~${Math.round(late)} min.`
                : `${rider.name} (${rider.label.toLowerCase()}) will be there when it's packed.`,
          }),
        );
        continue;
      }

      /* No own rider in time → Porter, one booking per order. */
      for (const m of members) {
        const bookAt = porterBookAt(m.readyAt, stats, cfg);
        const inMin = Math.round((bookAt - now) / MIN);
        const when =
          inMin <= 0 ? 'Book Porter now.' : `Book Porter in ${inMin} min.`;
        /* Porter collects no cash: say so on the suggestion itself, not later. */
        const cash =
          m.codAmount > 0
            ? ` Cash order (₹${Math.round(m.codAmount)}): get UPI payment first, or wait for your own rider.`
            : '';
        out.push({
          ...base(m),
          kind: 'porter',
          porterBookAt: new Date(bookAt).toISOString(),
          porterBookInMin: inMin,
          reason:
            (rider
              ? `Nearest own rider (${rider.name}) is ~${Math.round(late)} min late for this one. ${when}`
              : `No own rider free. ${when}`) + cash,
        });
      }
    }
    return {
      generatedAt: new Date(now).toISOString(),
      suggestions: out,
      riders,
    };
  }

  /** Apply one suggestion (the admin's "Do it" tap, or auto-dispatch). */
  async apply(s: Suggestion, source: 'suggested' | 'auto') {
    if (s.kind === 'join' && s.tripId)
      return this.trips.addToTrip(s.tripId, s.orderId);
    if (s.kind === 'trip' && s.tripOrderIds && s.riderId) {
      return this.trips.createTrip({
        orderIds: s.tripOrderIds,
        riderId: s.riderId,
        source,
      });
    }
    if (s.kind === 'rider' && s.riderId) {
      return this.trips.createTrip({
        orderIds: [s.orderId],
        riderId: s.riderId,
        source,
      });
    }
    return null;
  }

  /* ─────────────────────────── background loop ─────────────────────────── */

  /**
   * Every 30 s, on one instance only (Postgres advisory lock, so running
   * several API pods never double-dispatches or double-apologises).
   */
  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    const qr = this.ds.createQueryRunner();
    let locked = false;
    try {
      await qr.connect();
      const [l] = await qr.query(`SELECT pg_try_advisory_lock($1) AS ok`, [
        DispatchService.LOCK,
      ]);
      locked = !!l?.ok;
      if (!locked) return;

      const last = await this.eta.lastComputed();
      if (!last || Date.now() - last.getTime() > 12 * 3600_000)
        await this.eta.recompute();

      await this.delayAlerts();

      const { cfg } = await this.eta.config();
      if (cfg.autoDispatch) await this.autoDispatch();
    } catch (e: unknown) {
      this.logger.warn(
        `Dispatch tick failed: ${e instanceof Error ? e.message : e}`,
      );
    } finally {
      if (locked)
        await qr
          .query(`SELECT pg_advisory_unlock($1)`, [DispatchService.LOCK])
          .catch(() => {});
      await qr.release().catch(() => {});
      this.running = false;
    }
  }

  /** Phase 5: assign what is about to be ready. Porter still needs a human tap (no API). */
  async autoDispatch() {
    const { suggestions } = await this.suggestions();
    const due = suggestions.filter(
      (s) => ['join', 'trip', 'rider'].includes(s.kind) && s.readyInMin <= 5,
    );
    const done = new Set<number>();
    let applied = 0;
    for (const s of due) {
      if (done.has(s.orderId)) continue;
      try {
        await this.apply(s, 'auto');
        (s.tripOrderIds || [s.orderId]).forEach((id) => done.add(id));
        applied++;
      } catch (e: unknown) {
        this.logger.warn(
          `Auto-dispatch skipped ${s.orderNumber}: ${e instanceof Error ? e.message : e}`,
        );
      }
    }
    if (applied) this.logger.log(`Auto-dispatch: ${applied} assignment(s).`);
    return applied;
  }

  /**
   * Phase 4: tell the customer BEFORE they notice. Live ETA past the promise
   * by more than the grace window → one apology with the new time.
   */
  async delayAlerts(now = Date.now()) {
    const { cfg, settings } = await this.eta.config();
    const rows = await this.ds.query(
      `SELECT id, user_id, order_number, promised_at FROM orders
        WHERE status IN ('order_confirmed','preparing_food','food_ready','assigned_to_delivery','out_for_delivery','arriving_soon')
          AND promised_at IS NOT NULL AND delay_notified_at IS NULL
        ORDER BY promised_at LIMIT 100`,
    );
    let sent = 0;
    for (const r of rows) {
      try {
        const t: any = await this.orders.track(Number(r.id));
        if (t.etaMinutes == null) continue;
        const liveAt = now + Number(t.etaMinutes) * MIN;
        if (!isDelayed(liveAt, new Date(r.promised_at).getTime(), cfg))
          continue;
        const claimed = returned(
          await this.ds.query(
            `UPDATE orders SET delay_notified_at = now() WHERE id = $1 AND delay_notified_at IS NULL RETURNING id`,
            [r.id],
          ),
        );
        if (!claimed.length) continue;
        const when = new Intl.DateTimeFormat('en-IN', {
          hour: 'numeric',
          minute: '2-digit',
          timeZone: settings.timezone || 'Asia/Kolkata',
        }).format(new Date(liveAt));
        const title = '⏱️ Running a little late';
        const body = `Order ${r.order_number} is now expected around ${when}. Sorry for the wait — it's on its way as fast as we can.`;
        await this.ds.query(
          `INSERT INTO notifications (user_id, order_id, channel, title, body, is_sent)
           VALUES ($1,$2,'in_app',$3,$4,true)`,
          [r.user_id, r.id, title, body],
        );
        const [u] = await this.ds.query(
          `SELECT email FROM users WHERE id = $1`,
          [r.user_id],
        );
        this.mail.send(
          u?.email,
          `${title} — Bite Theory`,
          this.mail.statusHtml(r.order_number, title, body),
        );
        sent++;
      } catch {
        /* one bad order must not stop the others */
      }
    }
    return sent;
  }
}
