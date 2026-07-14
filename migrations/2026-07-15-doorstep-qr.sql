-- Doorstep UPI QR: customer pays online at the door, rider never touches cash.

CREATE TABLE IF NOT EXISTS order_qr_payments (
  id                  SERIAL PRIMARY KEY,
  order_id            BIGINT      NOT NULL REFERENCES orders(id),
  razorpay_qr_id      TEXT        NOT NULL UNIQUE,
  razorpay_payment_id TEXT        UNIQUE,
  amount_paise        BIGINT      NOT NULL,
  image_url           TEXT,
  -- active | paid | closed  (closed = rider fell back to cash, or expired)
  status              TEXT        NOT NULL DEFAULT 'active',
  close_by            TIMESTAMPTZ NOT NULL,
  created_by_rider    BIGINT,
  paid_at             TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- At most ONE live QR per order. This is the DB-level guarantee that a rider
-- tapping "Show QR" five times cannot mint five payable QRs for one order.
CREATE UNIQUE INDEX IF NOT EXISTS order_qr_one_active_idx
  ON order_qr_payments (order_id) WHERE status = 'active';

CREATE INDEX IF NOT EXISTS order_qr_order_idx ON order_qr_payments (order_id);

-- Rider cash ledger: cash only, never QR/online. This is the number that must
-- reconcile against deposits.
CREATE TABLE IF NOT EXISTS rider_cash_ledger (
  id         SERIAL PRIMARY KEY,
  rider_id   BIGINT      NOT NULL,
  order_id   BIGINT      UNIQUE,          -- one cash entry per order, ever
  -- 'collect' = +cash in hand, 'deposit' = -cash in hand
  kind       TEXT        NOT NULL,
  amount     NUMERIC     NOT NULL,
  note       TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS rider_cash_ledger_rider_idx ON rider_cash_ledger (rider_id);

-- Double-collection alarm: customer paid the QR *and* handed over cash.
CREATE TABLE IF NOT EXISTS payment_incidents (
  id         SERIAL PRIMARY KEY,
  order_id   BIGINT,
  kind       TEXT        NOT NULL,   -- 'double_collection' | 'amount_mismatch'
  details    JSONB,
  resolved   BOOLEAN     NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
