-- 2026-07-15 — security hardening (P0-1, P0-2, P0-3, P1)
-- Safe to re-run.

-- P1: webhook dead-letter. Razorpay captured the money but checkout() threw,
-- and we already returned 200 so Razorpay will never retry. Previously this
-- was a console.error and the customer's money silently vanished.
CREATE TABLE IF NOT EXISTS failed_payments (
  id                  SERIAL PRIMARY KEY,
  razorpay_payment_id TEXT UNIQUE,
  razorpay_order_id   TEXT,
  amount_paise        BIGINT,
  error               TEXT,
  payload             JSONB,
  resolved            BOOLEAN     NOT NULL DEFAULT false,
  resolved_by         TEXT,
  resolved_at         TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS failed_payments_unresolved_idx
  ON failed_payments (created_at DESC) WHERE resolved = false;

-- P1: orders are financial records. Never hard-delete — you will need this row
-- for a chargeback dispute months from now.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS orders_not_deleted_idx
  ON orders (created_at DESC) WHERE deleted_at IS NULL;

-- P0-1 defence in depth: even if application code regresses, the DATABASE
-- refuses to walk a delivered order back to cancelled. Belt and braces on the
-- single most expensive bug in the system.
CREATE OR REPLACE FUNCTION orders_block_terminal_transition()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.status = 'delivered' AND NEW.status <> 'delivered' THEN
    RAISE EXCEPTION
      'order % is delivered (terminal) — refund via POST /orders/:id/refund, not a status change',
      OLD.id;
  END IF;
  IF OLD.status = 'cancelled' AND NEW.status <> 'cancelled' THEN
    RAISE EXCEPTION 'order % is cancelled (terminal)', OLD.id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS orders_terminal_status_guard ON orders;
CREATE TRIGGER orders_terminal_status_guard
  BEFORE UPDATE OF status ON orders
  FOR EACH ROW EXECUTE FUNCTION orders_block_terminal_transition();
