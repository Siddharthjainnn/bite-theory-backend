-- Bite Theory: rider earnings + tips payout + COD reconciliation + delivery OTP
-- Idempotent — safe to run multiple times on Neon.

-- per-delivery pay ledger (§4.1 / §4.2)
CREATE TABLE IF NOT EXISTS rider_earnings (
  id                  bigserial PRIMARY KEY,
  delivery_partner_id bigint NOT NULL,
  order_id            bigint NOT NULL UNIQUE,   -- one payout row per order, retry-safe
  base_fare           numeric NOT NULL DEFAULT 0,
  distance_pay        numeric NOT NULL DEFAULT 0,
  tip                 numeric NOT NULL DEFAULT 0,
  total               numeric NOT NULL DEFAULT 0,
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_rider_earnings_partner
  ON rider_earnings (delivery_partner_id, created_at DESC);

-- COD cash deposits recorded by admin (§4.3)
CREATE TABLE IF NOT EXISTS rider_cash_deposits (
  id                  bigserial PRIMARY KEY,
  delivery_partner_id bigint NOT NULL,
  amount              numeric NOT NULL,
  note                text,
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_rider_deposits_partner
  ON rider_cash_deposits (delivery_partner_id, created_at DESC);

-- delivery handoff OTP (§4.5)
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS delivery_otp varchar(4);

-- rider pay rates (§4.2)
ALTER TABLE store_settings
  ADD COLUMN IF NOT EXISTS rider_base_fare   numeric NOT NULL DEFAULT 20,
  ADD COLUMN IF NOT EXISTS rider_per_km_pay  numeric NOT NULL DEFAULT 5;
