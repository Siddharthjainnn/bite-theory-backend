-- ════════════════════════════════════════════════════════════════════════
-- Online takeaway: the customer orders on the website / app and collects
-- the food at an outlet (Vijay Nagar cloud kitchen, Bhawarkua outlet …).
--
--  * outlets.pickup_enabled   — show this outlet as a takeaway option
--  * outlets.pickup_opens_on  — takeaway starts on this date (shown as
--                               "Opening 21 Nov" until then; refused by the
--                               server before it)
--  * outlets.cooks_delivery   — this kitchen cooks the delivery orders
--                               (Live Orders "this outlet" filter uses it)
--  * outlets.latitude/longitude/maps_url/pickup_note — "Get directions" and
--                               the line the customer sees, e.g. "Collect at
--                               the counter, show your order code"
--  * orders.fulfillment       — 'delivery' (default, every existing order) or 'pickup'
--  * orders.pickup_outlet_id  — where a pickup order is collected
--
-- A pickup order skips the rider entirely: no delivery fee, no rider tip,
-- no dispatch, no Porter. Its steps are Preparing → Ready for pickup →
-- Picked up. Idempotent: safe to run again.
-- ════════════════════════════════════════════════════════════════════════

ALTER TABLE outlets ADD COLUMN IF NOT EXISTS pickup_enabled  BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE outlets ADD COLUMN IF NOT EXISTS pickup_opens_on DATE;
ALTER TABLE outlets ADD COLUMN IF NOT EXISTS cooks_delivery  BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE outlets ADD COLUMN IF NOT EXISTS latitude        NUMERIC(10,7);
ALTER TABLE outlets ADD COLUMN IF NOT EXISTS longitude       NUMERIC(10,7);
ALTER TABLE outlets ADD COLUMN IF NOT EXISTS maps_url        VARCHAR(500);
ALTER TABLE outlets ADD COLUMN IF NOT EXISTS pickup_note     VARCHAR(200);

ALTER TABLE orders ADD COLUMN IF NOT EXISTS fulfillment      VARCHAR(10) NOT NULL DEFAULT 'delivery';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS pickup_outlet_id INTEGER REFERENCES outlets(id);

DO $$ BEGIN
  ALTER TABLE orders ADD CONSTRAINT orders_fulfillment_chk
    CHECK (fulfillment IN ('delivery', 'pickup'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE orders ADD CONSTRAINT orders_pickup_outlet_chk
    CHECK (fulfillment = 'delivery' OR pickup_outlet_id IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS orders_pickup_outlet_idx
  ON orders (pickup_outlet_id) WHERE pickup_outlet_id IS NOT NULL;

-- ── Vijay Nagar cloud kitchen: cooks every delivery order, takeaway on ──
-- Uses the kitchen pin and address already saved in Store Settings.
-- Skipped if an outlet with code VJN or "Vijay" in its name already exists.
INSERT INTO outlets (code, name, address, latitude, longitude, pickup_enabled, cooks_delivery,
                     pickup_note, sort_order)
SELECT 'VJN', 'Vijay Nagar (Cloud Kitchen)',
       COALESCE(NULLIF(trim(s.store_address), ''), 'Vijay Nagar, Indore'),
       s.store_lat, s.store_lng, true, true,
       'Collect from the kitchen counter. Show your order code.', 2
  FROM (SELECT 1) one
  LEFT JOIN store_settings s ON s.id = 1
 WHERE NOT EXISTS (SELECT 1 FROM outlets WHERE code = 'VJN' OR name ILIKE '%vijay%');

UPDATE outlets SET cooks_delivery = true, pickup_enabled = true
 WHERE (code = 'VJN' OR name ILIKE '%vijay%')
   AND NOT EXISTS (SELECT 1 FROM outlets WHERE cooks_delivery);

-- ── Bhawarkua: takeaway listed now, orderable from opening day (21 Nov 2026) ──
UPDATE outlets
   SET pickup_enabled = true,
       pickup_opens_on = COALESCE(pickup_opens_on, DATE '2026-11-21'),
       pickup_note = COALESCE(pickup_note, 'Collect at the counter. Show your order code.')
 WHERE code = 'BKW';
