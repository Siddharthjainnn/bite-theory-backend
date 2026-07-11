-- Spin the Thali: admin-curated wheel pool.
-- Products flagged is_spin_wheel = true form the wheel's candidate pool.
-- If fewer than 4 are flagged (or none), the frontend falls back to all
-- in-stock items, so the feature can never break from under-curation.

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS is_spin_wheel BOOLEAN NOT NULL DEFAULT false;
