import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { OrdersService } from '../orders/orders.service';
import { DeliveryPartnerService } from '../delivery_partners/delivery_partners.service';
import { EtaService } from './eta.service';
import {
  DispatchConfig,
  PoolOrder,
  Pt,
  RiderView,
  RoutePlan,
  areaIssues,
  bestRoute,
  driveMin,
  planRoute,
} from './dispatch.algo';
import { setStopOrder } from './trip.sql';

const MIN = 60_000;
const BOOKABLE = [
  'order_confirmed',
  'preparing_food',
  'food_ready',
  'assigned_to_delivery',
];

export interface RiderStatus extends RiderView {
  mobile: string | null;
  capacity: number;
  shiftStatus: string;
  stopsLeft: number;
  plannedOrders: number;
  label: string; // "At kitchen", "On trip · 2 stops · back ~12 min"
  tripId: number | null;
}

/**
 * TripsService — riders, their state, and trips (PRD: "Multi-order delivery").
 * Status changes still go through OrdersService.updateStatus, so the state
 * machine, OTP, cash cap and notifications apply to every bag on a trip.
 */
@Injectable()
export class TripsService {
  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    private readonly orders: OrdersService,
    private readonly partners: DeliveryPartnerService,
    private readonly eta: EtaService,
  ) {}

  async store(): Promise<Pt | null> {
    const { settings } = await this.eta.config();
    return settings.storeLat != null && settings.storeLng != null
      ? { lat: Number(settings.storeLat), lng: Number(settings.storeLng) }
      : null;
  }

  /** Predicted moment the food is ready: actual if ready, else accepted + estimated prep. */
  static readyAtOf(o: any, defaultPrep: number, now: number): number {
    if (o.ready_at) return new Date(o.ready_at).getTime();
    const start = new Date(o.accepted_at || o.placed_at).getTime();
    const prep =
      Number(o.prep_estimate_min) > 0
        ? Number(o.prep_estimate_min)
        : defaultPrep;
    return Math.max(start + prep * MIN, now + 2 * MIN); // a late kitchen is "about 2 min away", not in the past
  }

  /* ─────────────────────────── riders ─────────────────────────── */

  async riders(now = Date.now()): Promise<RiderStatus[]> {
    const [riders, trips, returning, today, store, mpk] = await Promise.all([
      this.ds.query(
        `SELECT id, name, mobile, shift_status, capacity, current_lat, current_lng
           FROM delivery_partners WHERE is_active = true ORDER BY name`,
      ),
      this.ds.query(
        `SELECT t.id, t.rider_id, t.status, s.seq, s.delivered_at, o.delivery_lat AS lat, o.delivery_lng AS lng
           FROM delivery_trips t
           JOIN trip_stops s ON s.trip_id = t.id
           JOIN orders o ON o.id = s.order_id
          WHERE t.status IN ('planned','picked_up')
          ORDER BY t.id, s.seq`,
      ),
      this.ds.query(
        `SELECT DISTINCT ON (rider_id) rider_id, return_eta_at FROM delivery_trips
          WHERE status = 'done' AND return_eta_at > now() ORDER BY rider_id, ended_at DESC`,
      ),
      this.ds.query(
        `SELECT delivery_partner_id AS rider_id, COUNT(*)::int AS n FROM orders
          WHERE status = 'delivered' AND delivered_at::date = now()::date
          GROUP BY delivery_partner_id`,
      ),
      this.store(),
      this.eta.minPerKm(new Date(now)),
    ]);
    const cap = DeliveryPartnerService.cashCap();
    const back = new Map<number, number>(
      returning.map((r: any) => [
        Number(r.rider_id),
        new Date(r.return_eta_at).getTime(),
      ]),
    );
    const done = new Map<number, number>(
      today.map((r: any) => [Number(r.rider_id), Number(r.n)]),
    );

    const out: RiderStatus[] = [];
    for (const r of riders) {
      const id = Number(r.id);
      const mine = trips.filter((t: any) => Number(t.rider_id) === id);
      const onRoad = mine.filter(
        (t: any) =>
          t.status === 'picked_up' && !t.delivered_at && t.lat != null,
      );
      const planned = mine.filter((t: any) => t.status === 'planned');
      const tripId = mine.length ? Number(mine[0].id) : null;

      let state: RiderView['state'] = 'at_kitchen';
      let availableAt = now;
      let label = 'At kitchen';
      if (onRoad.length || mine.some((t: any) => t.status === 'picked_up')) {
        state = 'on_trip';
        /* remaining route: rider (or kitchen) → remaining stops → kitchen */
        let here: Pt | null =
          r.current_lat != null
            ? { lat: Number(r.current_lat), lng: Number(r.current_lng) }
            : store;
        let mins = 0;
        for (const s of onRoad) {
          const pt = { lat: Number(s.lat), lng: Number(s.lng) };
          if (here) mins += driveMin(here, pt, mpk);
          here = pt;
        }
        if (here && store) mins += driveMin(here, store, mpk);
        availableAt = now + mins * MIN;
        label = `On trip · ${onRoad.length} stop${onRoad.length === 1 ? '' : 's'} left · back ~${Math.round(mins)} min`;
      } else if (planned.length) {
        state = 'assigned';
        label = `${planned.length} order${planned.length === 1 ? '' : 's'} waiting to pick up`;
      } else if (back.has(id)) {
        state = 'returning';
        availableAt = back.get(id)!;
        label = `Returning · back ~${Math.max(1, Math.round((availableAt - now) / MIN))} min`;
      }
      if (r.shift_status === 'offline' && state !== 'on_trip') {
        state = 'offline';
        label = 'Offline';
      }

      const cash = await this.partners.cashInHand(id).catch(() => 0);
      out.push({
        id,
        name: r.name || `Rider #${id}`,
        mobile: r.mobile ?? null,
        capacity: Number(r.capacity) || 2,
        shiftStatus: r.shift_status || 'online',
        state,
        availableAt,
        label,
        tripId,
        cashHeadroom: Math.max(0, cap - cash),
        deliveriesToday: done.get(id) || 0,
        stopsLeft: onRoad.length,
        plannedOrders: planned.length,
      });
    }
    return out;
  }

  async setShift(riderId: number, status: 'online' | 'offline') {
    await this.ds.query(
      `UPDATE delivery_partners SET shift_status = $2 WHERE id = $1`,
      [riderId, status],
    );
    return { ok: true, shiftStatus: status };
  }

  /* ─────────────────────────── trips ─────────────────────────── */

  /** Orders as the planner sees them. */
  async poolOrders(
    orderIds: number[],
    now = Date.now(),
  ): Promise<(PoolOrder & { row: any })[]> {
    const { settings } = await this.eta.config();
    const defaultPrep = Number(settings.avgPrepMinutes) || 20;
    const rows = await this.ds.query(
      `SELECT o.*, p.method AS pay_method, p.status AS pay_status
         FROM orders o
         LEFT JOIN LATERAL (SELECT method, status FROM payments WHERE order_id = o.id ORDER BY id DESC LIMIT 1) p ON true
        WHERE o.id = ANY($1)`,
      [orderIds],
    );
    return rows.map((o: any) => ({
      orderId: Number(o.id),
      readyAt: TripsService.readyAtOf(o, defaultPrep, now),
      promisedAt: o.promised_at ? new Date(o.promised_at).getTime() : null,
      dest: { lat: Number(o.delivery_lat), lng: Number(o.delivery_lng) },
      codAmount:
        o.pay_method === 'cod' && o.pay_status === 'pending'
          ? Math.max(0, Number(o.total) - Number(o.wallet_used || 0))
          : 0,
      row: o,
    }));
  }

  /** Why a set of orders cannot ride together, in words the admin can act on. */
  static explain(
    plan: RoutePlan,
    pool: PoolOrder[],
    cfg: DispatchConfig,
    numbers: Map<number, string>,
    store?: Pt | null,
  ): string[] {
    const reasons: string[] = [];
    /* Same area, same direction first: the rule the kitchen thinks in. */
    if (store) {
      for (const i of areaIssues(pool, store, cfg)) {
        const a = numbers.get(i.a) || `#${i.a}`,
          b = numbers.get(i.b) || `#${i.b}`;
        reasons.push(
          i.kind === 'gap'
            ? `${a} and ${b} are ${i.value} km apart (limit ${cfg.batchMaxDropGapKm} km).`
            : `${a} and ${b} are in different directions from the kitchen (${i.value}° apart, limit ${cfg.batchMaxBearingDeg}°).`,
        );
      }
    }
    const readies = pool.map((p) => p.readyAt);
    const gap = (Math.max(...readies) - Math.min(...readies)) / MIN;
    if (gap > cfg.batchReadyGapMin)
      reasons.push(
        `Ready times are ${Math.round(gap)} min apart (limit ${cfg.batchReadyGapMin}).`,
      );
    plan.orderIds.forEach((id, k) => {
      const o = pool.find((p) => p.orderId === id)!;
      const n = numbers.get(id) || `#${id}`;
      if (plan.extraWaitMin[k] > cfg.batchMaxExtraMin) {
        reasons.push(
          `${n} would wait ${Math.round(plan.extraWaitMin[k])} extra min (limit ${cfg.batchMaxExtraMin}).`,
        );
      }
      const age = (plan.arrivals[k] - o.readyAt) / MIN;
      if (age > cfg.foodAgeMaxMin)
        reasons.push(
          `${n}'s food would be ${Math.round(age)} min old on arrival (limit ${cfg.foodAgeMaxMin}).`,
        );
      if (o.promisedAt != null && plan.arrivals[k] > o.promisedAt) {
        reasons.push(
          `${n} would arrive ${Math.round((plan.arrivals[k] - o.promisedAt) / MIN)} min after its promise.`,
        );
      }
    });
    return reasons.length
      ? reasons
      : ['These orders do not fit the batching rules.'];
  }

  /**
   * Group 1-3 orders into a trip for one rider, in the best legal drop order.
   * Rules broken → refused with the reasons, unless `force` (the admin knows
   * something the planner does not: same building, customer will wait...).
   */
  async createTrip(input: {
    orderIds: number[];
    riderId: number;
    force?: boolean;
    source?: 'admin' | 'suggested' | 'auto';
  }) {
    const ids = [
      ...new Set(
        (input.orderIds || [])
          .map(Number)
          .filter((n) => Number.isInteger(n) && n > 0),
      ),
    ];
    if (!ids.length) throw new BadRequestException('Pick at least one order.');
    const [rider] = await this.ds.query(
      `SELECT id, name, is_active, capacity, shift_status FROM delivery_partners WHERE id = $1`,
      [input.riderId],
    );
    if (!rider || rider.is_active === false)
      throw new BadRequestException('That rider is not active.');
    if (ids.length > (Number(rider.capacity) || 2)) {
      throw new BadRequestException(
        `${rider.name} can carry ${rider.capacity} orders per trip.`,
      );
    }

    const pool = await this.poolOrders(ids);
    if (pool.length !== ids.length)
      throw new NotFoundException('One of those orders no longer exists.');
    const numbers = new Map<number, string>(
      pool.map((p) => [p.orderId, p.row.order_number]),
    );
    for (const p of pool) {
      const n = p.row.order_number;
      if (!BOOKABLE.includes(p.row.status))
        throw new BadRequestException(
          `${n} is ${p.row.status.replace(/_/g, ' ')}, so it can't join a trip.`,
        );
      if (p.row.delivery_provider && p.row.delivery_provider !== 'in_house') {
        throw new BadRequestException(
          `${n} is booked with Porter. Remove that booking first.`,
        );
      }
    }
    const cod = pool.reduce((s, p) => s + p.codAmount, 0);
    if (cod > 0) {
      const headroom =
        DeliveryPartnerService.cashCap() -
        (await this.partners.cashInHand(Number(rider.id)));
      if (cod > headroom) {
        throw new BadRequestException(
          `${rider.name} can only take ₹${Math.max(0, Math.floor(headroom))} more cash; this trip has ₹${cod.toFixed(0)} COD.`,
        );
      }
    }

    const { cfg } = await this.eta.config();
    const store = await this.store();
    const mpk = await this.eta.minPerKm();
    const pinned = pool.every(
      (p) => Number.isFinite(p.dest.lat) && Number.isFinite(p.dest.lng),
    );
    let plan: RoutePlan | null = null;
    if (store && pinned) {
      plan = bestRoute(pool, store, mpk, cfg);
      if (!plan && pool.length > 1 && !input.force) {
        const relaxed = {
          ...cfg,
          batchMaxExtraMin: 1e9,
          batchReadyGapMin: 1e9,
          foodAgeMaxMin: 1e9,
          batchMaxDropGapKm: 0,
          batchMaxBearingDeg: 180,
        };
        const loose = bestRoute(
          pool.map((p) => ({ ...p, promisedAt: null })),
          store,
          mpk,
          relaxed,
        )!;
        const strict =
          planRoute(
            loose.orderIds.map((id) => pool.find((p) => p.orderId === id)!),
            store,
            mpk,
            { ...relaxed, foodAgeMaxMin: 1e9 },
          ) ?? loose;
        throw new BadRequestException({
          statusCode: 400,
          error: 'Bad Request',
          canForce: true,
          message: 'These orders should not ride together.',
          reasons: TripsService.explain(strict, pool, cfg, numbers, store),
        });
      }
      if (!plan)
        plan = bestRoute(pool, store, mpk, {
          ...cfg,
          batchMaxExtraMin: 1e9,
          batchReadyGapMin: 1e9,
          foodAgeMaxMin: 1e9,
          batchMaxDropGapKm: 0,
          batchMaxBearingDeg: 180,
        });
    } else if (pool.length > 1 && !input.force) {
      throw new BadRequestException({
        statusCode: 400,
        error: 'Bad Request',
        canForce: true,
        message:
          "Can't plan the route: the kitchen or a customer has no map pin.",
        reasons: [
          !store
            ? 'Set the kitchen pin in Settings → Store.'
            : 'At least one order has no pin; call the customer.',
        ],
      });
    }

    const order = plan ? plan.orderIds : ids;
    const [t] = await this.ds.query(
      `INSERT INTO delivery_trips (rider_id, status, source, planned_minutes, saving_minutes)
       VALUES ($1, 'planned', $2, $3, $4) RETURNING id`,
      [
        rider.id,
        input.source ?? 'admin',
        plan ? Math.round(plan.tripMinutes) : null,
        plan && order.length > 1 ? Math.round(plan.savingMinutes) : null,
      ],
    );
    const tripId = Number(t.id);
    for (const id of order) {
      await this.orders.assignRider(id, Number(rider.id), {
        tripId,
        source: input.source ?? 'admin',
      });
    }
    await setStopOrder(
      this.ds,
      tripId,
      order,
      plan ? plan.arrivals.map((a) => new Date(a)) : undefined,
    );
    return this.trip(tripId);
  }

  /** Add one order to an open (planned) trip. */
  async addToTrip(tripId: number, orderId: number, force = false) {
    const [t] = await this.ds.query(
      `SELECT id, rider_id, status FROM delivery_trips WHERE id = $1`,
      [tripId],
    );
    if (!t || t.status !== 'planned')
      throw new BadRequestException('That trip has already left or closed.');
    const current = await this.ds.query(
      `SELECT order_id FROM trip_stops WHERE trip_id = $1`,
      [tripId],
    );
    const ids = [
      ...current.map((c: any) => Number(c.order_id)),
      Number(orderId),
    ];
    /* Re-plan the whole trip so the drop order is optimal with the new stop. */
    await this.ds.query(
      `UPDATE delivery_trips SET status = 'cancelled' WHERE id = $1 AND status = 'planned'`,
      [tripId],
    );
    try {
      return await this.createTrip({
        orderIds: ids,
        riderId: Number(t.rider_id),
        force,
      });
    } catch (e) {
      await this.ds.query(
        `UPDATE delivery_trips SET status = 'planned' WHERE id = $1`,
        [tripId],
      );
      throw e;
    }
  }

  async reorder(tripId: number, orderIds: number[]) {
    const stops = await this.ds.query(
      `SELECT order_id FROM trip_stops WHERE trip_id = $1`,
      [tripId],
    );
    const have = stops.map((s: any) => Number(s.order_id)).sort();
    const want = [...orderIds].map(Number).sort();
    if (
      have.length !== want.length ||
      have.some((v: number, i: number) => v !== want[i])
    ) {
      throw new BadRequestException(
        'Send every order on the trip, in the new order.',
      );
    }
    await setStopOrder(this.ds, tripId, orderIds.map(Number));
    return this.trip(tripId);
  }

  /** A trip with its stops, in drop order. */
  async trip(tripId: number) {
    const [t] = await this.ds.query(
      `SELECT t.*, dp.name AS rider_name FROM delivery_trips t
         JOIN delivery_partners dp ON dp.id = t.rider_id WHERE t.id = $1`,
      [tripId],
    );
    if (!t) throw new NotFoundException('Trip not found');
    const stops = await this.ds.query(
      `SELECT s.seq, s.eta_at, s.delivered_at, o.id AS order_id, o.order_number, o.status,
              o.delivery_address, o.delivery_lat, o.delivery_lng, o.delivery_instructions,
              o.total, o.wallet_used, a.landmark,
              u.first_name, u.last_name, u.mobile,
              p.method AS pay_method, p.status AS pay_status
         FROM trip_stops s
         JOIN orders o ON o.id = s.order_id
         LEFT JOIN users u ON u.id = o.user_id
         LEFT JOIN addresses a ON a.id = o.address_id
         LEFT JOIN LATERAL (SELECT method, status FROM payments WHERE order_id = o.id ORDER BY id DESC LIMIT 1) p ON true
        WHERE s.trip_id = $1 ORDER BY s.seq`,
      [tripId],
    );
    return {
      id: Number(t.id),
      riderId: Number(t.rider_id),
      riderName: t.rider_name,
      status: t.status,
      source: t.source,
      plannedMinutes:
        t.planned_minutes != null ? Number(t.planned_minutes) : null,
      savingMinutes: t.saving_minutes != null ? Number(t.saving_minutes) : null,
      pickedUpAt: t.picked_up_at,
      endedAt: t.ended_at,
      stops: stops.map((s: any) => ({
        seq: s.seq,
        orderId: Number(s.order_id),
        orderNumber: s.order_number,
        status: s.status,
        etaAt: s.eta_at,
        deliveredAt: s.delivered_at,
        customerName:
          `${s.first_name || ''} ${s.last_name || ''}`.trim() || 'Customer',
        customerMobile: s.mobile ?? null,
        address: s.delivery_address,
        landmark: s.landmark ?? null,
        instructions: s.delivery_instructions ?? null,
        lat: s.delivery_lat != null ? Number(s.delivery_lat) : null,
        lng: s.delivery_lng != null ? Number(s.delivery_lng) : null,
        cashToCollect:
          s.pay_method === 'cod' && s.pay_status === 'pending'
            ? Math.max(0, Number(s.total) - Number(s.wallet_used || 0))
            : 0,
      })),
    };
  }

  /** Open trips (admin board). */
  async openTrips() {
    const rows = await this.ds.query(
      `SELECT id FROM delivery_trips WHERE status IN ('planned','picked_up') ORDER BY id`,
    );
    return Promise.all(rows.map((r: any) => this.trip(Number(r.id))));
  }

  /** The rider app's view: the trip on the road (or waiting), plus what is next. */
  async riderTrip(riderId: number) {
    const rows = await this.ds.query(
      `SELECT id, status FROM delivery_trips WHERE rider_id = $1 AND status IN ('planned','picked_up')
        ORDER BY (status = 'picked_up') DESC, id`,
      [riderId],
    );
    const [r] = await this.ds.query(
      `SELECT shift_status FROM delivery_partners WHERE id = $1`,
      [riderId],
    );
    const current = rows[0] ? await this.trip(Number(rows[0].id)) : null;
    const next = rows[1] ? await this.trip(Number(rows[1].id)) : null;
    return {
      shiftStatus: r?.shift_status || 'online',
      trip: current,
      next: next ? { id: next.id, orders: next.stops.length } : null,
    };
  }

  /** Rider collects every bag on the trip in one tap. */
  async pickup(tripId: number, riderId: number) {
    const trip = await this.trip(tripId);
    if (trip.riderId !== Number(riderId))
      throw new ForbiddenException('This is not your trip.');
    if (trip.status !== 'planned')
      throw new BadRequestException('This trip is already on the road.');
    const cooking = trip.stops.filter(
      (s) => !['food_ready', 'assigned_to_delivery'].includes(s.status),
    );
    if (cooking.length) {
      throw new BadRequestException(
        `${cooking.map((s) => s.orderNumber).join(', ')} ${cooking.length === 1 ? 'is' : 'are'} not packed yet. Wait for the kitchen.`,
      );
    }
    for (const s of trip.stops) {
      if (s.status === 'food_ready') {
        /* Rider was reserved while it cooked; the hand-over makes it theirs. */
        await this.orders.updateStatus(
          s.orderId,
          { status: 'assigned_to_delivery', note: 'Handed to rider' } as any,
          false,
          true,
        );
      }
      await this.orders.updateStatus(
        s.orderId,
        { status: 'out_for_delivery' } as any,
        false,
        false,
        Number(riderId),
      );
    }
    return this.trip(tripId);
  }
}
