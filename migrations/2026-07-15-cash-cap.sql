-- Cash cap + reconciliation.
-- Run AFTER 2026-07-15-doorstep-qr.sql (which creates rider_cash_ledger).

-- Backfill the ledger from history, so cash-in-hand doesn't reset to zero on
-- deploy. Only orders whose payment row is STILL 'cod' count as cash — anything
-- paid online (incl. by doorstep QR) never touched the rider's pocket.
INSERT INTO rider_cash_ledger (rider_id, order_id, kind, amount, note, created_at)
SELECT o.delivery_partner_id,
       o.id,
       'collect',
       GREATEST(o.total - COALESCE(o.wallet_used, 0), 0),
       'Backfill from delivered COD history',
       COALESCE(o.delivered_at, o.placed_at, now())
  FROM orders o
  JOIN payments p ON p.order_id = o.id AND p.method = 'cod'
 WHERE o.status = 'delivered'
   AND o.delivery_partner_id IS NOT NULL
   AND GREATEST(o.total - COALESCE(o.wallet_used, 0), 0) > 0
ON CONFLICT (order_id) DO NOTHING;

-- Speeds up the cap check, which now runs on every rider assignment.
CREATE INDEX IF NOT EXISTS rider_cash_ledger_rider_kind_idx
  ON rider_cash_ledger (rider_id, kind);
