-- Bite Theory: restaurant location + distance pricing + order distance
-- Idempotent — safe to run multiple times on Neon.

ALTER TABLE store_settings
  ADD COLUMN IF NOT EXISTS store_lat               numeric(10,7),
  ADD COLUMN IF NOT EXISTS store_lng               numeric(10,7),
  ADD COLUMN IF NOT EXISTS store_address           text,
  ADD COLUMN IF NOT EXISTS delivery_radius_km      numeric  NOT NULL DEFAULT 8,
  ADD COLUMN IF NOT EXISTS avg_prep_minutes        integer  NOT NULL DEFAULT 20,
  ADD COLUMN IF NOT EXISTS avg_rider_kmph          numeric  NOT NULL DEFAULT 20,
  ADD COLUMN IF NOT EXISTS base_delivery_charge    numeric  NOT NULL DEFAULT 20,
  ADD COLUMN IF NOT EXISTS per_km_charge           numeric  NOT NULL DEFAULT 8,
  ADD COLUMN IF NOT EXISTS free_delivery_within_km numeric  NOT NULL DEFAULT 2;

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS distance_km numeric;

-- Optional: set your kitchen pin now (replace with your real coordinates):
-- UPDATE store_settings SET store_lat = 22.7196, store_lng = 75.8577,
--   store_address = 'Your kitchen address' WHERE id = 1;
