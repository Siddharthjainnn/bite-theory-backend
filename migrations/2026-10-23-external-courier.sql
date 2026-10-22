-- External courier dispatch (Porter, and any 3PL later: Rapido, Borzo, Shadowfax).
--
-- Until now an order could only leave the kitchen with an in-house rider
-- (orders.delivery_partner_id). At dinner rush there are more orders than
-- riders, so the kitchen books a Porter two-wheeler by hand. Those deliveries
-- were invisible to the system: the order had no rider, so the state machine
-- refused out_for_delivery, and staff were forced to fake-assign a house rider.
--
-- These columns record the booking honestly. delivery_provider says WHO carries
-- the order; the external_* columns hold what the admin copied back from Porter.
-- Idempotent: safe to re-run.

ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_provider     varchar(20) NOT NULL DEFAULT 'in_house';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS external_ref          varchar(80);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS external_tracking_url text;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS external_rider_name   varchar(80);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS external_rider_phone  varchar(20);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS external_fee          numeric(10,2);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS external_booked_at    timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'orders_delivery_provider_chk') THEN
    ALTER TABLE orders ADD CONSTRAINT orders_delivery_provider_chk
      CHECK (delivery_provider IN ('in_house', 'porter', 'other'));
  END IF;
END $$;

-- Finance asks "what did Porter cost us this week?" — keep that query cheap.
CREATE INDEX IF NOT EXISTS idx_orders_provider_placed
  ON orders (delivery_provider, placed_at)
  WHERE delivery_provider <> 'in_house';
