-- Happy-hour flash deals: storewide % off in a time window. One active max.
CREATE TABLE IF NOT EXISTS flash_deals (
  id BIGSERIAL PRIMARY KEY,
  title VARCHAR NOT NULL,
  discount_pct NUMERIC NOT NULL,
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true
);
