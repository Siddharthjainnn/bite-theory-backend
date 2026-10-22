import { returned } from '../common/sql.util';
/**
 * Trip bookkeeping in plain SQL, shared by OrdersService (status changes,
 * rider assignment) and TripsService (admin grouping, rider pickup).
 *
 * Kept free of Nest injection on purpose: OrdersService must call these
 * without depending on the delivery module (which itself depends on
 * OrdersService). Every function takes the same `q` — a DataSource or a
 * transaction's EntityManager — so callers choose the transaction.
 */

export interface Q {
  query: (sql: string, params?: unknown[]) => Promise<any[]>;
}

export const ACTIVE_TRIP = `('planned','picked_up')`;
export const LIVE_ORDER = `('order_received','order_confirmed','preparing_food','food_ready','assigned_to_delivery','out_for_delivery','arriving_soon')`;

/**
 * A rider is available when they carry nothing. This replaces the old
 * "is_available = true on every delivered", which freed a rider after the
 * FIRST drop of a two-order trip while the second bag was still on the bike.
 */
export async function refreshRiderAvailability(
  q: Q,
  riderId: number | null | undefined,
) {
  if (!riderId) return;
  await q.query(
    `UPDATE delivery_partners dp
        SET is_available = NOT EXISTS (
          SELECT 1 FROM orders o
           WHERE o.delivery_partner_id = dp.id
             AND o.status IN ('assigned_to_delivery','out_for_delivery','arriving_soon'))
      WHERE dp.id = $1`,
    [riderId],
  );
}

/** Close a trip once nothing undelivered is left on it. */
async function settleTrip(q: Q, tripId: number, returnEtaMin: number | null) {
  const [left] = await q.query(
    `SELECT COUNT(*) FILTER (WHERE delivered_at IS NULL)::int AS open,
            COUNT(*)::int AS total
       FROM trip_stops WHERE trip_id = $1`,
    [tripId],
  );
  if (!left) return { done: false, total: 0 };
  if (left.total === 0) {
    await q.query(
      `UPDATE delivery_trips SET status = 'cancelled', ended_at = now()
        WHERE id = $1 AND status IN ${ACTIVE_TRIP}`,
      [tripId],
    );
    return { done: false, total: 0 };
  }
  if (left.open === 0) {
    await q.query(
      `UPDATE delivery_trips
          SET status = 'done', ended_at = now(),
              return_eta_at = now() + make_interval(mins => $2::int)
        WHERE id = $1 AND status IN ${ACTIVE_TRIP}`,
      [tripId, Math.max(0, Math.round(returnEtaMin ?? 0))],
    );
    return { done: true, total: left.total };
  }
  return { done: false, total: left.total };
}

async function resequence(q: Q, tripId: number) {
  await q.query(
    `UPDATE trip_stops s SET seq = r.rn
       FROM (SELECT id, ROW_NUMBER() OVER (ORDER BY seq, id) AS rn
               FROM trip_stops WHERE trip_id = $1) r
      WHERE s.id = r.id`,
    [tripId],
  );
}

/** Take an order off whatever trip it is on (reassignment, Porter, cancel). */
export async function detachFromTrip(q: Q, orderId: number) {
  const rows = returned(
    await q.query(
      `DELETE FROM trip_stops WHERE order_id = $1 RETURNING trip_id`,
      [orderId],
    ),
  );
  await q.query(`UPDATE orders SET trip_id = NULL WHERE id = $1`, [orderId]);
  for (const r of rows) {
    await resequence(q, Number(r.trip_id));
    await settleTrip(q, Number(r.trip_id), null);
  }
}

/**
 * Put an order on a rider's trip.
 *  - `tripId` given: that trip (must be the rider's and still planned).
 *  - otherwise: the rider's planned trip if it has room, else a new trip.
 * A rider already out on a picked-up trip gets a NEW planned trip: their
 * next run, which they collect when they are back.
 */
export async function attachToTrip(
  q: Q,
  orderId: number,
  riderId: number,
  opts: {
    tripId?: number;
    capacity?: number;
    source?: 'admin' | 'suggested' | 'auto';
  } = {},
): Promise<number> {
  await detachFromTrip(q, orderId);
  const capacity = Math.max(1, opts.capacity ?? 2);

  let tripId: number | null = null;
  if (opts.tripId) {
    const [t] = await q.query(
      `SELECT id FROM delivery_trips WHERE id = $1 AND rider_id = $2 AND status = 'planned'`,
      [opts.tripId, riderId],
    );
    if (!t) throw new Error('That trip is no longer open for this rider.');
    tripId = Number(t.id);
  } else {
    const [t] = await q.query(
      `SELECT t.id FROM delivery_trips t
         LEFT JOIN trip_stops s ON s.trip_id = t.id
        WHERE t.rider_id = $1 AND t.status = 'planned'
        GROUP BY t.id HAVING COUNT(s.id) < $2
        ORDER BY t.id LIMIT 1`,
      [riderId, capacity],
    );
    if (t) tripId = Number(t.id);
  }
  if (!tripId) {
    const [t] = await q.query(
      `INSERT INTO delivery_trips (rider_id, status, source) VALUES ($1, 'planned', $2) RETURNING id`,
      [riderId, opts.source ?? 'admin'],
    );
    tripId = Number(t.id);
  }
  await q.query(
    `INSERT INTO trip_stops (trip_id, order_id, seq)
     VALUES ($1, $2, COALESCE((SELECT MAX(seq) FROM trip_stops WHERE trip_id = $1), 0) + 1)`,
    [tripId, orderId],
  );
  await q.query(`UPDATE orders SET trip_id = $1 WHERE id = $2`, [
    tripId,
    orderId,
  ]);
  return tripId;
}

/** First bag leaves the kitchen → the whole trip is on the road. */
export async function markTripPickedUp(q: Q, orderId: number) {
  await q.query(
    `UPDATE delivery_trips SET status = 'picked_up', picked_up_at = now()
      WHERE id = (SELECT trip_id FROM orders WHERE id = $1) AND status = 'planned'`,
    [orderId],
  );
}

/**
 * Stop delivered. Returns the trip id and, if this was the last stop, how
 * many orders the trip carried (for the batch bonus).
 */
export async function markStopDelivered(
  q: Q,
  orderId: number,
  returnEtaMin: number | null,
) {
  const rows = returned(
    await q.query(
      `UPDATE trip_stops SET delivered_at = now()
      WHERE order_id = $1 AND delivered_at IS NULL RETURNING trip_id`,
      [orderId],
    ),
  );
  if (!rows.length)
    return { tripId: null as number | null, done: false, total: 0 };
  const tripId = Number(rows[0].trip_id);
  const r = await settleTrip(q, tripId, returnEtaMin);
  return { tripId, ...r };
}

/** Set an explicit drop order (admin reorder, or the planner's route). */
export async function setStopOrder(
  q: Q,
  tripId: number,
  orderIds: number[],
  etas?: (Date | null)[],
) {
  for (let i = 0; i < orderIds.length; i++) {
    await q.query(
      `UPDATE trip_stops SET seq = $3, eta_at = COALESCE($4, eta_at) WHERE trip_id = $1 AND order_id = $2`,
      [tripId, orderIds[i], i + 1, etas?.[i] ?? null],
    );
  }
  await resequence(q, tripId);
}
