/**
 * Delivery algorithms — pure functions, no I/O, every rule unit-tested.
 *
 * Three questions, answered here and nowhere else:
 *   1. WHEN will this order arrive?           quoteEta()
 *   2. WHICH orders should ride together?     formTrips()
 *   3. WHO should carry them?                 rankRiders() / porterBookAt()
 *
 * Distances are straight-line km. Instead of paying for road routing, the
 * model learns an "effective speed" per hour band: straight-line km divided
 * by real pickup-to-delivered minutes. That one number absorbs road detours,
 * traffic, parking and the OTP at the door, and it is measured from this
 * kitchen's own deliveries (see EtaService.recompute).
 */
import { haversineKm } from '../common/geo.util';

/* ─────────────────────────── configuration ─────────────────────────── */

export interface DispatchConfig {
  /* batching */
  batchMaxOrders: number; // orders per trip (1 disables batching)
  batchMaxExtraMin: number; // extra wait any customer may get vs a solo drop
  batchReadyGapMin: number; // ready times within this many minutes
  foodAgeMaxMin: number; // ready → delivered, every order in a trip
  batchBonus: number; // ₹ paid to the rider per extra order on a trip
  /* time model fallbacks (used until enough history exists) */
  prepStepMin: number; // minutes per extra item beyond the slowest
  prepStepCapMin: number; // cap on that step
  kitchenParallel: number; // orders the kitchen cooks at once without slowing
  queuePerOrderMin: number; // minutes added per order beyond kitchenParallel
  defaultAcceptMin: number; // placed → accepted
  defaultHandoffMin: number; // ready → picked up
  defaultSpeedKmph: number; // effective straight-line km/h, pickup → delivered
  porterArrivalMin: number; // Porter booking → driver at the kitchen
  minRangeWidthMin: number; // the customer range is at least this wide
  /* customer promises */
  delayAlertMin: number; // live ETA past the promise by this → apologise
  lateMakegoodMin: number; // delivered this late or more → make good
  lateMakegoodAmount: number; // ₹ wallet credit (0 = off)
  /* automation */
  autoDispatch: boolean; // system assigns riders/trips without a tap
}

export const DEFAULT_DISPATCH: DispatchConfig = {
  batchMaxOrders: 2,
  batchMaxExtraMin: 8,
  batchReadyGapMin: 5,
  foodAgeMaxMin: 30,
  batchBonus: 10,
  prepStepMin: 2,
  prepStepCapMin: 10,
  kitchenParallel: 3,
  queuePerOrderMin: 4,
  defaultAcceptMin: 2,
  defaultHandoffMin: 4,
  defaultSpeedKmph: 15,
  porterArrivalMin: 12,
  minRangeWidthMin: 10,
  delayAlertMin: 5,
  lateMakegoodMin: 15,
  lateMakegoodAmount: 0,
  autoDispatch: false,
};

/** Merge stored config over defaults, coercing types (jsonb can hold anything). */
export function normalizeDispatch(raw: unknown): DispatchConfig {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<
    string,
    unknown
  >;
  const out = { ...DEFAULT_DISPATCH };
  for (const k of Object.keys(DEFAULT_DISPATCH) as (keyof DispatchConfig)[]) {
    const v = r[k];
    if (v === undefined || v === null || v === '') continue;
    if (typeof DEFAULT_DISPATCH[k] === 'boolean')
      (out as any)[k] = v === true || v === 'true';
    else if (Number.isFinite(Number(v)) && Number(v) >= 0)
      (out as any)[k] = Number(v);
  }
  out.batchMaxOrders = Math.min(3, Math.max(1, Math.round(out.batchMaxOrders)));
  out.defaultSpeedKmph = Math.max(3, out.defaultSpeedKmph);
  out.kitchenParallel = Math.max(1, Math.round(out.kitchenParallel));
  return out;
}

/* ─────────────────────────── hour bands ─────────────────────────── */

export type Band = 'breakfast' | 'lunch' | 'evening' | 'dinner' | 'late';
export const BANDS: Band[] = [
  'breakfast',
  'lunch',
  'evening',
  'dinner',
  'late',
];

/** Kitchen hour band in the store's timezone. */
export function hourBand(at: Date, timeZone = 'Asia/Kolkata'): Band {
  const h =
    Number(
      new Intl.DateTimeFormat('en-GB', {
        hour: '2-digit',
        hour12: false,
        timeZone,
      }).format(at),
    ) % 24;
  if (h >= 6 && h < 11) return 'breakfast';
  if (h >= 11 && h < 15) return 'lunch';
  if (h >= 15 && h < 19) return 'evening';
  if (h >= 19 && h < 23) return 'dinner';
  return 'late';
}

/* ─────────────────────────── learned stats ─────────────────────────── */

export type StatPart =
  | 'accept'
  | 'prep_ratio'
  | 'handoff'
  | 'speed'
  | 'porter_arrival';
export interface Stat {
  median: number;
  p80: number;
  n: number;
}
export type BandStats = Partial<Record<StatPart, Stat>>;

/** A stat is trusted once it has this many samples in its band. */
export const MIN_SAMPLES = 20;

const trusted = (s?: Stat) =>
  !!s && s.n >= MIN_SAMPLES && Number.isFinite(s.median);

/** Median and 80th percentile of a sample (linear interpolation). */
export function summarize(values: number[]): Stat {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  const q = (p: number) => {
    if (!v.length) return NaN;
    const i = (v.length - 1) * p,
      lo = Math.floor(i),
      hi = Math.ceil(i);
    return v[lo] + (v[hi] - v[lo]) * (i - lo);
  };
  return { median: q(0.5), p80: q(0.8), n: v.length };
}

/* ─────────────────────────── prep time ─────────────────────────── */

export interface PrepItem {
  prepMinutes: number | null;
  quantity: number;
}

/**
 * An order cooks in parallel: it takes as long as its slowest item, plus a
 * small step for every extra unit (plating, packing). Items without their own
 * prep time use the store default.
 */
export function prepMinutes(
  items: PrepItem[],
  defaultPrep: number,
  cfg: DispatchConfig,
): number {
  if (!items.length) return defaultPrep;
  const slowest = Math.max(
    ...items.map((i) =>
      i.prepMinutes && i.prepMinutes > 0 ? i.prepMinutes : defaultPrep,
    ),
  );
  const units = items.reduce(
    (n, i) => n + Math.max(1, Math.round(i.quantity || 1)),
    0,
  );
  const step = Math.min(
    cfg.prepStepCapMin,
    Math.max(0, units - 1) * cfg.prepStepMin,
  );
  return slowest + step;
}

/** Extra minutes because the kitchen already has orders on the stove. */
export function queueMinutes(
  ordersCooking: number,
  cfg: DispatchConfig,
): number {
  return (
    Math.max(0, ordersCooking - cfg.kitchenParallel + 1) * cfg.queuePerOrderMin
  );
}

/* ─────────────────────────── ETA quote ─────────────────────────── */

export interface EtaInput {
  prepMin: number; // from prepMinutes()
  ordersCooking: number; // accepted but not yet ready, excluding this one
  distanceKm: number | null;
  stats: BandStats; // this hour band's learned stats
  cfg: DispatchConfig;
}

export interface EtaQuote {
  minMin: number; // shown as the low end ("30")
  maxMin: number; // shown as the high end ("40"); this is the promise
  breakdown: {
    accept: number;
    prep: number;
    queue: number;
    handoff: number;
    travel: number;
  };
}

const roundDown5 = (n: number) => Math.max(5, Math.floor(n / 5) * 5);
const roundUp5 = (n: number) => Math.ceil(n / 5) * 5;

/**
 * Promise = accept + prep + queue + handoff + travel.
 * Low end uses medians, high end the 80th percentile (or a fallback spread).
 * The high end is saved as promised_at: we promise what we hit 4 times in 5.
 */
export function quoteEta(i: EtaInput): EtaQuote {
  const { cfg, stats } = i;
  const accept = trusted(stats.accept)
    ? stats.accept!
    : { median: cfg.defaultAcceptMin, p80: cfg.defaultAcceptMin * 2 };
  const ratio = trusted(stats.prep_ratio)
    ? stats.prep_ratio!
    : { median: 1, p80: 1.2 };
  const handoff = trusted(stats.handoff)
    ? stats.handoff!
    : { median: cfg.defaultHandoffMin, p80: cfg.defaultHandoffMin * 2 };
  /* speed: the SLOW tail is the 20th percentile; we store p80 of minutes-per-km
     instead, so higher is slower and p80 is the cautious end. */
  const minPerKm = trusted(stats.speed)
    ? stats.speed!
    : {
        median: 60 / cfg.defaultSpeedKmph,
        p80: (60 / cfg.defaultSpeedKmph) * 1.25,
      };

  const km =
    i.distanceKm != null && Number.isFinite(i.distanceKm)
      ? Math.max(0, i.distanceKm)
      : 3;
  const queue = queueMinutes(i.ordersCooking, cfg);

  const lowRaw =
    accept.median +
    i.prepMin * ratio.median +
    queue +
    handoff.median +
    km * minPerKm.median;
  /* High end: the stages vary independently, so a slow kitchen, a slow
     handoff and a slow ride rarely all land on one order. Adding every
     stage's 80th percentile would promise a worst case of worst cases
     (and show "35-55"); combining the spreads as a root-sum-of-squares is
     the standard estimate for the spread of a sum of independent parts. */
  const spreads = [
    accept.p80 - accept.median,
    i.prepMin * (ratio.p80 - ratio.median),
    handoff.p80 - handoff.median,
    km * (minPerKm.p80 - minPerKm.median),
  ].map((d) => Math.max(0, d));
  const highRaw = lowRaw + Math.sqrt(spreads.reduce((n, d) => n + d * d, 0));

  const minMin = roundDown5(lowRaw);
  let maxMin = roundUp5(Math.max(highRaw, lowRaw));
  if (maxMin - minMin < cfg.minRangeWidthMin)
    maxMin = minMin + cfg.minRangeWidthMin;

  return {
    minMin,
    maxMin,
    breakdown: {
      accept: Math.round(accept.p80),
      prep: Math.round(i.prepMin * ratio.p80),
      queue: Math.round(queue),
      handoff: Math.round(handoff.p80),
      travel: Math.round(km * minPerKm.p80),
    },
  };
}

/* ─────────────────────────── travel ─────────────────────────── */

export interface Pt {
  lat: number;
  lng: number;
}

/** Minutes to drive between two points at the learned effective speed. */
export function driveMin(a: Pt, b: Pt, minPerKm: number): number {
  return haversineKm(a.lat, a.lng, b.lat, b.lng) * minPerKm;
}

/** Median minutes-per-km for planning (not the cautious promise number). */
export function planningMinPerKm(
  stats: BandStats,
  cfg: DispatchConfig,
): number {
  return trusted(stats.speed) ? stats.speed!.median : 60 / cfg.defaultSpeedKmph;
}

/* ─────────────────────────── batching ─────────────────────────── */

export interface PoolOrder {
  orderId: number;
  readyAt: number; // ms epoch: actual ready_at, or predicted
  promisedAt: number | null; // ms epoch
  dest: Pt;
  codAmount: number; // unpaid cash on delivery (0 if prepaid)
}

export interface RoutePlan {
  orderIds: number[]; // drop order
  departAt: number; // ms: when the rider leaves the kitchen
  arrivals: number[]; // ms: per stop, same order as orderIds
  tripMinutes: number; // kitchen → stops → back
  soloMinutes: number; // the same orders as separate round trips
  savingMinutes: number; // soloMinutes − tripMinutes
  extraWaitMin: number[]; // per stop, vs delivering it alone
}

const MIN = 60_000;

/** When each order would arrive if it went alone, the moment it is ready. */
function soloArrival(o: PoolOrder, store: Pt, mpk: number) {
  return o.readyAt + driveMin(store, o.dest, mpk) * MIN;
}

/** Evaluate one drop sequence. Returns null if any batching rule breaks. */
export function planRoute(
  seq: PoolOrder[],
  store: Pt,
  mpk: number,
  cfg: DispatchConfig,
): RoutePlan | null {
  if (!seq.length) return null;
  const readies = seq.map((o) => o.readyAt);
  if (Math.max(...readies) - Math.min(...readies) > cfg.batchReadyGapMin * MIN)
    return null;

  const departAt = Math.max(...readies);
  const arrivals: number[] = [];
  let t = departAt,
    here = store,
    legs = 0;
  for (const o of seq) {
    const leg = driveMin(here, o.dest, mpk);
    legs += leg;
    t += leg * MIN;
    arrivals.push(t);
    here = o.dest;
  }
  const back = driveMin(here, store, mpk);
  const tripMinutes = legs + back;
  const soloMinutes = seq.reduce(
    (n, o) => n + 2 * driveMin(store, o.dest, mpk),
    0,
  );

  const extraWaitMin: number[] = [];
  for (let k = 0; k < seq.length; k++) {
    const o = seq[k];
    const extra = (arrivals[k] - soloArrival(o, store, mpk)) / MIN;
    if (seq.length > 1 && extra > cfg.batchMaxExtraMin) return null;
    if ((arrivals[k] - o.readyAt) / MIN > cfg.foodAgeMaxMin) return null;
    if (o.promisedAt != null && arrivals[k] > o.promisedAt) return null;
    extraWaitMin.push(Math.max(0, Math.round(extra * 10) / 10));
  }
  return {
    orderIds: seq.map((o) => o.orderId),
    departAt,
    arrivals,
    tripMinutes,
    soloMinutes,
    savingMinutes: soloMinutes - tripMinutes,
    extraWaitMin,
  };
}

function permutations<T>(xs: T[]): T[][] {
  if (xs.length <= 1) return [xs];
  return xs.flatMap((x, i) =>
    permutations([...xs.slice(0, i), ...xs.slice(i + 1)]).map((p) => [x, ...p]),
  );
}

/**
 * Best legal drop order for a set. Cost = rider minutes + half the customers'
 * total wait. A loop driven either way is the same length, so without the
 * customer term the tie would go to whichever order happened to come first;
 * with it, the nearer customer is dropped first and nobody waits for nothing.
 */
export function bestRoute(
  set: PoolOrder[],
  store: Pt,
  mpk: number,
  cfg: DispatchConfig,
): RoutePlan | null {
  const cost = (p: RoutePlan, seq: PoolOrder[]) =>
    p.tripMinutes +
    0.5 * p.arrivals.reduce((n, at, k) => n + (at - seq[k].readyAt) / MIN, 0);
  let best: { p: RoutePlan; c: number } | null = null;
  for (const seq of permutations(set)) {
    const p = planRoute(seq, store, mpk, cfg);
    if (!p) continue;
    const c = cost(p, seq);
    if (!best || c < best.c - 0.01) best = { p, c };
  }
  return best ? best.p : null;
}

/**
 * Greedy trip formation (PRD: "How a trip is formed").
 *  1. Score every legal pair by minutes saved vs two solo trips.
 *  2. Take the best pair; if trips of 3 are allowed, grow it by the order
 *     that keeps every rule and saves the most.
 *  3. Remove those orders and repeat. Leftovers go solo.
 * Small pools (one kitchen) make the O(n²) pass trivial.
 */
export function formTrips(
  pool: PoolOrder[],
  store: Pt,
  mpk: number,
  cfg: DispatchConfig,
): RoutePlan[] {
  const left = [...pool];
  const trips: RoutePlan[] = [];
  const max = cfg.batchMaxOrders;

  while (left.length) {
    let best: { plan: RoutePlan; set: PoolOrder[] } | null = null;
    if (max >= 2) {
      for (let a = 0; a < left.length; a++) {
        for (let b = a + 1; b < left.length; b++) {
          const plan = bestRoute([left[a], left[b]], store, mpk, cfg);
          if (
            plan &&
            plan.savingMinutes > 0.5 &&
            (!best || plan.savingMinutes > best.plan.savingMinutes)
          ) {
            best = { plan, set: [left[a], left[b]] };
          }
        }
      }
    }
    if (!best) break;

    while (best.set.length < max) {
      let grow: { plan: RoutePlan; set: PoolOrder[] } | null = null;
      for (const o of left) {
        if (best.set.includes(o)) continue;
        const set = [...best.set, o];
        const plan = bestRoute(set, store, mpk, cfg);
        if (
          plan &&
          plan.savingMinutes > best.plan.savingMinutes + 0.5 &&
          (!grow || plan.savingMinutes > grow.plan.savingMinutes)
        ) {
          grow = { plan, set };
        }
      }
      if (!grow) break;
      best = grow;
    }

    trips.push(best.plan);
    for (const o of best.set) left.splice(left.indexOf(o), 1);
  }

  for (const o of left) {
    const plan = planRoute([o], store, mpk, cfg);
    /* A solo order that already breaks its promise still needs a carrier; plan
       it without the promise/food-age gates so it is never dropped. */
    trips.push(
      plan ??
        planRoute(
          [{ ...o, promisedAt: null, readyAt: o.readyAt }],
          store,
          mpk,
          { ...cfg, foodAgeMaxMin: Number.MAX_SAFE_INTEGER },
        )!,
    );
  }
  return trips;
}

/* ─────────────────────────── riders ─────────────────────────── */

export type RiderState =
  | 'offline'
  | 'at_kitchen'
  | 'assigned'
  | 'on_trip'
  | 'returning';

export interface RiderView {
  id: number;
  name: string;
  state: RiderState;
  availableAt: number; // ms: when they can next leave the kitchen with food
  cashHeadroom: number; // ₹ more cash they may hold
  deliveriesToday: number;
}

/**
 * Rank riders for a trip that is ready to leave at `readyAt`.
 * Best = arrives just before the food is ready. Early costs a little (rider
 * idle), late costs double (food waiting). Cash cap and fairness filter/tie-break.
 */
export function rankRiders<T extends RiderView>(
  riders: T[],
  readyAt: number,
  codAmount: number,
  now: number,
): T[] {
  const slackMs = 2 * MIN;
  const cost = (r: RiderView) => {
    const at = Math.max(r.availableAt, now);
    const target = readyAt - slackMs;
    const d = (at - target) / MIN;
    return d > 0 ? d * 2 : -d;
  };
  return riders
    .filter((r) => r.state !== 'offline' && r.state !== 'assigned')
    .filter((r) => codAmount <= 0 || r.cashHeadroom >= codAmount)
    .sort(
      (a, b) =>
        cost(a) - cost(b) ||
        a.deliveriesToday - b.deliveriesToday ||
        a.id - b.id,
    );
}

/** Minutes a rider would make the food wait (0 if they are there in time). */
export function riderLateMin(
  r: RiderView,
  readyAt: number,
  now: number,
): number {
  return Math.max(0, (Math.max(r.availableAt, now) - readyAt) / MIN);
}

/* ─────────────────────────── Porter timing ─────────────────────────── */

/** Book Porter this long before the food is ready, so the driver walks in as it is sealed. */
export function porterBookAt(
  readyAt: number,
  stats: BandStats,
  cfg: DispatchConfig,
): number {
  const arrival = trusted(stats.porter_arrival)
    ? stats.porter_arrival!.median
    : cfg.porterArrivalMin;
  return readyAt - arrival * MIN;
}

/* ─────────────────────────── customer promises ─────────────────────────── */

/** Should the customer get a delay apology now? */
export function isDelayed(
  liveEtaAt: number,
  promisedAt: number | null,
  cfg: DispatchConfig,
): boolean {
  return promisedAt != null && liveEtaAt > promisedAt + cfg.delayAlertMin * MIN;
}

/** Make-good owed for a delivered order, in ₹ (0 = none). */
export function makegoodFor(
  deliveredAt: number,
  promisedAt: number | null,
  cfg: DispatchConfig,
): number {
  if (promisedAt == null || cfg.lateMakegoodAmount <= 0) return 0;
  return deliveredAt - promisedAt >= cfg.lateMakegoodMin * MIN
    ? cfg.lateMakegoodAmount
    : 0;
}
