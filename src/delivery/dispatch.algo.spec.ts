import {
  DEFAULT_DISPATCH,
  normalizeDispatch,
  hourBand,
  summarize,
  prepMinutes,
  queueMinutes,
  quoteEta,
  planRoute,
  bestRoute,
  formTrips,
  rankRiders,
  riderLateMin,
  porterBookAt,
  isDelayed,
  makegoodFor,
  MIN_SAMPLES,
  areaIssues,
  bearingDeg,
  angleBetween,
  PoolOrder,
  RiderView,
  DispatchConfig,
} from './dispatch.algo';

const MIN = 60_000;
const cfg: DispatchConfig = { ...DEFAULT_DISPATCH };
const store = { lat: 22.7239, lng: 75.8857 };
const mpk = 4; // 15 km/h effective
const T0 = Date.UTC(2026, 9, 23, 7, 0); // 12:30 IST

/* A and B sit close together ~2.2-2.8 km north; C is ~2.2 km south. */
const A = { lat: 22.7439, lng: 75.8857 };
const B = { lat: 22.7489, lng: 75.8887 };
const C = { lat: 22.7039, lng: 75.8857 };
const order = (
  orderId: number,
  dest: { lat: number; lng: number },
  over: Partial<PoolOrder> = {},
): PoolOrder => ({
  orderId,
  readyAt: T0,
  promisedAt: null,
  dest,
  codAmount: 0,
  ...over,
});

describe('normalizeDispatch', () => {
  it('fills defaults and coerces strings', () => {
    const c = normalizeDispatch({
      batchMaxOrders: '3',
      autoDispatch: 'true',
      delayAlertMin: '7',
    });
    expect(c.batchMaxOrders).toBe(3);
    expect(c.autoDispatch).toBe(true);
    expect(c.delayAlertMin).toBe(7);
    expect(c.foodAgeMaxMin).toBe(DEFAULT_DISPATCH.foodAgeMaxMin);
  });
  it('clamps trip size to 1..3 and ignores junk', () => {
    expect(normalizeDispatch({ batchMaxOrders: 9 }).batchMaxOrders).toBe(3);
    expect(normalizeDispatch({ batchMaxOrders: 0 }).batchMaxOrders).toBe(1);
    expect(
      normalizeDispatch({ foodAgeMaxMin: -4, batchBonus: 'abc' }).foodAgeMaxMin,
    ).toBe(30);
    expect(normalizeDispatch(null)).toEqual(DEFAULT_DISPATCH);
  });
  it('auto-dispatch is off unless switched on', () => {
    expect(normalizeDispatch({}).autoDispatch).toBe(false);
  });
});

describe('hourBand (IST)', () => {
  it.each([
    [Date.UTC(2026, 9, 23, 2, 30), 'breakfast'], // 08:00
    [Date.UTC(2026, 9, 23, 7, 0), 'lunch'], // 12:30
    [Date.UTC(2026, 9, 23, 11, 0), 'evening'], // 16:30
    [Date.UTC(2026, 9, 23, 15, 0), 'dinner'], // 20:30
    [Date.UTC(2026, 9, 23, 18, 0), 'late'], // 23:30
  ])('%s → %s', (ms, band) => expect(hourBand(new Date(ms))).toBe(band));
});

describe('summarize', () => {
  it('median and p80 with interpolation', () => {
    const s = summarize([10, 20, 30, 40, 50]);
    expect(s).toEqual({ median: 30, p80: 42, n: 5 });
  });
  it('ignores non-finite values', () => {
    expect(summarize([NaN, 5, Infinity]).n).toBe(1);
  });
});

describe('prepMinutes', () => {
  it('slowest item plus a step per extra unit', () => {
    expect(
      prepMinutes(
        [
          { prepMinutes: 15, quantity: 1 },
          { prepMinutes: 5, quantity: 2 },
        ],
        20,
        cfg,
      ),
    ).toBe(15 + 2 * 2);
  });
  it('unknown items use the store default', () => {
    expect(prepMinutes([{ prepMinutes: null, quantity: 1 }], 20, cfg)).toBe(20);
  });
  it('the per-unit step is capped', () => {
    expect(prepMinutes([{ prepMinutes: 10, quantity: 20 }], 20, cfg)).toBe(
      10 + cfg.prepStepCapMin,
    );
  });
  it('one chai is faster than six thalis', () => {
    const chai = prepMinutes([{ prepMinutes: 5, quantity: 1 }], 20, cfg);
    const thalis = prepMinutes([{ prepMinutes: 18, quantity: 6 }], 20, cfg);
    expect(chai).toBeLessThan(thalis);
  });
});

describe('queueMinutes', () => {
  it('free until the kitchen is full, then per order', () => {
    expect(queueMinutes(0, cfg)).toBe(0);
    expect(queueMinutes(cfg.kitchenParallel - 1, cfg)).toBe(0);
    expect(queueMinutes(cfg.kitchenParallel, cfg)).toBe(cfg.queuePerOrderMin);
    expect(queueMinutes(cfg.kitchenParallel + 2, cfg)).toBe(
      3 * cfg.queuePerOrderMin,
    );
  });
});

describe('quoteEta', () => {
  it('returns a 5-minute-rounded range at least minRangeWidth wide', () => {
    const q = quoteEta({
      prepMin: 15,
      ordersCooking: 0,
      distanceKm: 3,
      stats: {},
      cfg,
    });
    expect(q.minMin % 5).toBe(0);
    expect(q.maxMin % 5).toBe(0);
    expect(q.maxMin - q.minMin).toBeGreaterThanOrEqual(cfg.minRangeWidthMin);
  });
  it('the range stays useful: spreads combine, they do not stack', () => {
    const q = quoteEta({
      prepMin: 18,
      ordersCooking: 0,
      distanceKm: 3.4,
      stats: {},
      cfg,
    });
    expect(q.maxMin - q.minMin).toBeLessThanOrEqual(15);
    const sumOfP80s = 4 + 18 * 1.2 + 8 + 3.4 * 4 * 1.25;
    expect(q.maxMin).toBeLessThan(Math.ceil(sumOfP80s / 5) * 5);
  });
  it('a busy kitchen pushes the promise out', () => {
    const calm = quoteEta({
      prepMin: 15,
      ordersCooking: 0,
      distanceKm: 3,
      stats: {},
      cfg,
    });
    const busy = quoteEta({
      prepMin: 15,
      ordersCooking: 8,
      distanceKm: 3,
      stats: {},
      cfg,
    });
    expect(busy.maxMin).toBeGreaterThan(calm.maxMin);
  });
  it('farther is later', () => {
    const near = quoteEta({
      prepMin: 15,
      ordersCooking: 0,
      distanceKm: 1,
      stats: {},
      cfg,
    });
    const far = quoteEta({
      prepMin: 15,
      ordersCooking: 0,
      distanceKm: 7,
      stats: {},
      cfg,
    });
    expect(far.maxMin).toBeGreaterThan(near.maxMin);
  });
  it('uses learned stats only once they have enough samples', () => {
    const slow = { median: 10, p80: 12, n: MIN_SAMPLES }; // 10 min per km
    const few = { median: 10, p80: 12, n: MIN_SAMPLES - 1 };
    const learned = quoteEta({
      prepMin: 15,
      ordersCooking: 0,
      distanceKm: 3,
      stats: { speed: slow },
      cfg,
    });
    const ignored = quoteEta({
      prepMin: 15,
      ordersCooking: 0,
      distanceKm: 3,
      stats: { speed: few },
      cfg,
    });
    const base = quoteEta({
      prepMin: 15,
      ordersCooking: 0,
      distanceKm: 3,
      stats: {},
      cfg,
    });
    expect(learned.maxMin).toBeGreaterThan(base.maxMin);
    expect(ignored).toEqual(base);
  });
  it('missing distance assumes 3 km rather than zero', () => {
    const unknown = quoteEta({
      prepMin: 15,
      ordersCooking: 0,
      distanceKm: null,
      stats: {},
      cfg,
    });
    const three = quoteEta({
      prepMin: 15,
      ordersCooking: 0,
      distanceKm: 3,
      stats: {},
      cfg,
    });
    expect(unknown).toEqual(three);
  });
});

describe('planRoute rules', () => {
  it('pairs two neighbours with almost no extra wait', () => {
    const p = planRoute([order(1, A), order(2, B)], store, mpk, cfg)!;
    expect(p).not.toBeNull();
    expect(p.savingMinutes).toBeGreaterThan(10);
    expect(Math.max(...p.extraWaitMin)).toBeLessThan(cfg.batchMaxExtraMin);
  });
  it('rejects opposite directions (extra wait too long)', () => {
    expect(planRoute([order(1, A), order(3, C)], store, mpk, cfg)).toBeNull();
  });
  it('rejects ready times too far apart', () => {
    const late = order(2, B, {
      readyAt: T0 + (cfg.batchReadyGapMin + 1) * MIN,
    });
    expect(planRoute([order(1, A), late], store, mpk, cfg)).toBeNull();
  });
  it('rejects a pair that would break a promise', () => {
    const tight = order(2, B, { promisedAt: T0 + 5 * MIN });
    expect(planRoute([order(1, A), tight], store, mpk, cfg)).toBeNull();
  });
  it('rejects food older than the limit', () => {
    const strict = { ...cfg, foodAgeMaxMin: 5 };
    expect(
      planRoute([order(1, A), order(2, B)], store, mpk, strict),
    ).toBeNull();
  });
  it('departs when the later order is ready', () => {
    const p = planRoute(
      [order(1, A), order(2, B, { readyAt: T0 + 3 * MIN })],
      store,
      mpk,
      cfg,
    )!;
    expect(p.departAt).toBe(T0 + 3 * MIN);
  });
});

describe('bestRoute', () => {
  it('drops the nearer customer first when it is shorter', () => {
    const p = bestRoute([order(2, B), order(1, A)], store, mpk, cfg)!;
    expect(p.orderIds).toEqual([1, 2]);
  });
});

describe('formTrips', () => {
  it('batches neighbours and sends the outlier solo', () => {
    const trips = formTrips(
      [order(1, A), order(2, B), order(3, C)],
      store,
      mpk,
      cfg,
    );
    const sets = trips.map((t) => [...t.orderIds].sort());
    expect(sets).toContainEqual([1, 2]);
    expect(sets).toContainEqual([3]);
  });
  it('never puts an order in two trips', () => {
    const trips = formTrips(
      [order(1, A), order(2, B), order(3, C), order(4, A)],
      store,
      mpk,
      cfg,
    );
    const ids = trips.flatMap((t) => t.orderIds).sort();
    expect(ids).toEqual([1, 2, 3, 4]);
  });
  it('batchMaxOrders = 1 turns batching off', () => {
    const trips = formTrips([order(1, A), order(2, B)], store, mpk, {
      ...cfg,
      batchMaxOrders: 1,
    });
    expect(trips.every((t) => t.orderIds.length === 1)).toBe(true);
  });
  it('grows to three when allowed and still legal', () => {
    const A2 = { lat: 22.7459, lng: 75.8867 };
    const trips = formTrips(
      [order(1, A), order(2, B), order(5, A2)],
      store,
      mpk,
      { ...cfg, batchMaxOrders: 3 },
    );
    expect(trips.some((t) => t.orderIds.length === 3)).toBe(true);
  });
  it('keeps an already-late order instead of dropping it', () => {
    const trips = formTrips(
      [order(9, A, { promisedAt: T0 - 10 * MIN })],
      store,
      mpk,
      cfg,
    );
    expect(trips).toHaveLength(1);
    expect(trips[0].orderIds).toEqual([9]);
  });
  it('handles an empty pool', () => {
    expect(formTrips([], store, mpk, cfg)).toEqual([]);
  });
});

describe('rankRiders', () => {
  const r = (id: number, over: Partial<RiderView>): RiderView => ({
    id,
    name: `R${id}`,
    state: 'at_kitchen',
    availableAt: T0,
    cashHeadroom: 3000,
    deliveriesToday: 0,
    ...over,
  });

  it('prefers the rider who arrives just before the food', () => {
    const ready = T0 + 10 * MIN;
    const early = r(1, { availableAt: T0 }); // waits 8 min
    const justInTime = r(2, { state: 'returning', availableAt: T0 + 7 * MIN });
    const late = r(3, { state: 'on_trip', availableAt: T0 + 20 * MIN });
    expect(
      rankRiders([early, late, justInTime], ready, 0, T0).map((x) => x.id),
    ).toEqual([2, 1, 3]);
  });
  it('excludes offline and already-assigned riders', () => {
    expect(
      rankRiders(
        [r(1, { state: 'offline' }), r(2, { state: 'assigned' })],
        T0,
        0,
        T0,
      ),
    ).toEqual([]);
  });
  it('drops riders without cash headroom for COD', () => {
    const full = r(1, { cashHeadroom: 100 });
    expect(rankRiders([full], T0, 400, T0)).toEqual([]);
    expect(rankRiders([full], T0, 0, T0)).toHaveLength(1);
  });
  it('breaks ties by fewer deliveries today', () => {
    const busy = r(1, { deliveriesToday: 9 }),
      fresh = r(2, { deliveriesToday: 1 });
    expect(rankRiders([busy, fresh], T0, 0, T0)[0].id).toBe(2);
  });
  it('lateness in minutes', () => {
    expect(riderLateMin(r(1, { availableAt: T0 + 6 * MIN }), T0, T0)).toBe(6);
    expect(riderLateMin(r(1, { availableAt: T0 }), T0 + 5 * MIN, T0)).toBe(0);
  });
});

describe('porter + promises', () => {
  it('books Porter its arrival time before the food is ready', () => {
    expect(porterBookAt(T0, {}, cfg)).toBe(T0 - cfg.porterArrivalMin * MIN);
    expect(
      porterBookAt(
        T0,
        { porter_arrival: { median: 9, p80: 14, n: MIN_SAMPLES } },
        cfg,
      ),
    ).toBe(T0 - 9 * MIN);
  });
  it('delay alert only past the grace window', () => {
    expect(isDelayed(T0 + 4 * MIN, T0, cfg)).toBe(false);
    expect(isDelayed(T0 + 6 * MIN, T0, cfg)).toBe(true);
    expect(isDelayed(T0, null, cfg)).toBe(false);
  });
  it('make-good is off by default and paid only when late enough', () => {
    expect(makegoodFor(T0 + 60 * MIN, T0, cfg)).toBe(0);
    const on = { ...cfg, lateMakegoodAmount: 30 };
    expect(makegoodFor(T0 + 14 * MIN, T0, on)).toBe(0);
    expect(makegoodFor(T0 + 15 * MIN, T0, on)).toBe(30);
    expect(makegoodFor(T0 + 60 * MIN, null, on)).toBe(0);
  });
});

describe('same area, same direction', () => {
  /* ~2.2 km north of the kitchen, and points around it */
  const N1 = { lat: 22.7439, lng: 75.8857 };
  const N2_25km = { lat: 22.7664, lng: 75.8857 }; // 2.5 km further north
  const EAST = { lat: 22.7239, lng: 75.9071 }; // ~2.2 km east of the kitchen
  const NEAR = { lat: 22.7279, lng: 75.8907 }; // ~0.7 km from the kitchen
  const loose = { ...cfg, batchMaxExtraMin: 1e9, foodAgeMaxMin: 1e9 }; // isolate the area rules

  it('bearing basics', () => {
    expect(Math.round(bearingDeg(store, N1))).toBe(0);
    expect(Math.round(bearingDeg(store, EAST))).toBe(90);
    expect(angleBetween(350, 10)).toBe(20);
    expect(angleBetween(90, 270)).toBe(180);
  });

  it('drops 2.5 km apart: refused at the 2 km default, allowed at 3 km', () => {
    const pair = [order(1, N1), order(2, N2_25km)];
    expect(planRoute(pair, store, mpk, loose)).toBeNull();
    expect(areaIssues(pair, store, loose)).toEqual([
      { kind: 'gap', a: 1, b: 2, value: 2.5 },
    ]);
    expect(
      planRoute(pair, store, mpk, { ...loose, batchMaxDropGapKm: 3 }),
    ).not.toBeNull();
  });

  it('different directions are refused even when the gap rule is off', () => {
    const pair = [order(1, N1), order(3, EAST)];
    const noGap = { ...loose, batchMaxDropGapKm: 0 };
    expect(planRoute(pair, store, mpk, noGap)).toBeNull();
    const issues = areaIssues(pair, store, noGap);
    expect(issues).toHaveLength(1);
    expect(issues[0].kind).toBe('direction');
    expect(issues[0].value).toBeGreaterThan(80);
    expect(
      planRoute(pair, store, mpk, { ...noGap, batchMaxBearingDeg: 180 }),
    ).not.toBeNull();
  });

  it('a drop right next to the kitchen is on the way for any direction', () => {
    expect(areaIssues([order(1, N1), order(4, NEAR)], store, loose)).toEqual(
      [],
    );
  });

  it('a solo order is never checked', () => {
    expect(planRoute([order(1, N2_25km)], store, mpk, cfg)).not.toBeNull();
  });

  it('formTrips keeps a far pair apart even if the time rules would allow it', () => {
    const trips = formTrips(
      [order(1, N1), order(2, N2_25km)],
      store,
      mpk,
      loose,
    );
    expect(trips.every((t) => t.orderIds.length === 1)).toBe(true);
  });

  it('settings: 0 km = no distance limit; angle is capped at 180', () => {
    expect(
      normalizeDispatch({ batchMaxBearingDeg: 500 }).batchMaxBearingDeg,
    ).toBe(180);
    expect(
      normalizeDispatch({ batchMaxDropGapKm: '3' }).batchMaxDropGapKm,
    ).toBe(3);
    expect(DEFAULT_DISPATCH.batchMaxDropGapKm).toBe(2);
    expect(DEFAULT_DISPATCH.batchMaxBearingDeg).toBe(45);
  });
});
