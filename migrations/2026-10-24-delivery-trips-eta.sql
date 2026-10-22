-- Delivery system: measurement, honest ETAs, multi-order trips, dispatch.
-- See the Delivery System PRD. Idempotent: safe to re-run. Additive only:
-- the previous backend keeps working against this schema.

-- ── Phase 1: measure. The promise is saved, and when food was actually ready.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS promised_at       timestamptz;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS promised_min      integer;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS promised_max      integer;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS ready_at          timestamptz;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS trip_id           bigint;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delay_notified_at timestamptz;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS late_makegood_at  timestamptz;
-- prep minutes the model expected at checkout; actual ÷ this = how far reality drifts
ALTER TABLE orders ADD COLUMN IF NOT EXISTS prep_estimate_min integer;

CREATE INDEX IF NOT EXISTS idx_orders_delivered_window
  ON orders (delivered_at) WHERE delivered_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_orders_trip ON orders (trip_id) WHERE trip_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_orders_live
  ON orders (status) WHERE status NOT IN ('delivered', 'cancelled');

-- ── Phase 2: prep time per product (NULL = use the store default).
ALTER TABLE products ADD COLUMN IF NOT EXISTS prep_minutes integer;

-- Learned time model, rebuilt from delivered orders. One row per hour band and part.
CREATE TABLE IF NOT EXISTS eta_stats (
  band        varchar(16) NOT NULL,
  part        varchar(24) NOT NULL,
  median      numeric     NOT NULL,
  p80         numeric     NOT NULL,
  n           integer     NOT NULL,
  computed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (band, part)
);

-- ── Phase 3: trips. A rider run from the kitchen and back, with ordered stops.
-- Existing riders default to ONLINE so dispatch keeps working the moment this
-- ships; riders can go offline from the rider app.
ALTER TABLE delivery_partners ADD COLUMN IF NOT EXISTS shift_status varchar(10) NOT NULL DEFAULT 'online';
ALTER TABLE delivery_partners ADD COLUMN IF NOT EXISTS capacity     integer     NOT NULL DEFAULT 2;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'delivery_partners_shift_chk') THEN
    ALTER TABLE delivery_partners ADD CONSTRAINT delivery_partners_shift_chk
      CHECK (shift_status IN ('online', 'offline'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS delivery_trips (
  id              bigserial PRIMARY KEY,
  rider_id        bigint      NOT NULL,
  status          varchar(12) NOT NULL DEFAULT 'planned',
  source          varchar(12) NOT NULL DEFAULT 'admin',
  planned_minutes numeric,
  saving_minutes  numeric,
  created_at      timestamptz NOT NULL DEFAULT now(),
  picked_up_at    timestamptz,
  ended_at        timestamptz,
  return_eta_at   timestamptz,
  CONSTRAINT delivery_trips_status_chk CHECK (status IN ('planned', 'picked_up', 'done', 'cancelled')),
  CONSTRAINT delivery_trips_source_chk CHECK (source IN ('admin', 'suggested', 'auto'))
);
CREATE INDEX IF NOT EXISTS idx_trips_rider_active
  ON delivery_trips (rider_id) WHERE status IN ('planned', 'picked_up');

CREATE TABLE IF NOT EXISTS trip_stops (
  id           bigserial PRIMARY KEY,
  trip_id      bigint      NOT NULL REFERENCES delivery_trips (id) ON DELETE CASCADE,
  order_id     bigint      NOT NULL,
  seq          integer     NOT NULL,
  eta_at       timestamptz,
  delivered_at timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);
-- An order rides in at most one trip at a time.
CREATE UNIQUE INDEX IF NOT EXISTS uq_trip_stops_order ON trip_stops (order_id);
CREATE INDEX IF NOT EXISTS idx_trip_stops_trip ON trip_stops (trip_id, seq);

-- Batch bonus paid per extra order on a trip (Phase 3 rider pay).
ALTER TABLE rider_earnings ADD COLUMN IF NOT EXISTS batch_bonus numeric NOT NULL DEFAULT 0;

-- ── Phases 3-5: every tunable rule in one JSON blob, defaults merged in code
-- (src/delivery/dispatch.algo.ts DEFAULT_DISPATCH). Auto-dispatch stays OFF
-- until an admin turns it on.
ALTER TABLE store_settings ADD COLUMN IF NOT EXISTS dispatch_config jsonb;

-- ── Repair: rider cash ledger poisoned by NaN.
-- The delivered handler read an UPDATE ... RETURNING result as plain rows, so
-- every house-rider delivery (prepaid ones too) recorded a 'collect' of NaN.
-- One NaN makes the rider's SUM NaN, and "NaN >= cap" is false: the cash cap
-- never fired and real COD cash was never counted. Fixed in code (returned());
-- here we repair what was already written:
--   COD orders that were really paid in cash → their true amount
--   everything else (prepaid)                → removed, no cash moved
DO $$
BEGIN
  IF to_regclass('public.rider_cash_ledger') IS NOT NULL THEN
    UPDATE rider_cash_ledger l
       SET amount = p.amount
      FROM payments p
     WHERE l.order_id = p.order_id AND l.kind = 'collect' AND l.amount = 'NaN'
       AND p.method = 'cod' AND p.status = 'paid';
    DELETE FROM rider_cash_ledger WHERE kind = 'collect' AND amount = 'NaN';
  END IF;
END $$;
