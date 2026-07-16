-- ════════════════════════════════════════════════════════════════════════
-- GST + legal invoice numbering.
--
-- Two problems this fixes:
--
-- 1. TAX WAS HARDCODED TO ZERO.
--    checkout inserted `tax = 0` for every order, and the invoice only renders
--    a tax line when tax > 0 — so it never appeared. Fine while under the GST
--    threshold; illegal the day you register.
--
-- 2. NO INVOICE NUMBER.
--    invoices printed the ORDER number. GST law requires a separate,
--    sequential, unbroken series per financial year (e.g. BT/2026-27/0001).
--    Order numbers are random-ish and can have gaps (failed checkouts), which
--    is exactly what a tax invoice series may NOT have.
--
-- Design notes:
--  * Tax is stored PER ORDER (rate + cgst + sgst), never recomputed from
--    today's settings. If you change the rate next year, last year's invoices
--    must still show what was actually charged.
--  * The invoice counter is a real sequence table with a row lock, not
--    MAX(id)+1 — two simultaneous checkouts would otherwise get the same
--    number, and duplicate invoice numbers are a compliance failure.
--  * Numbers are issued at CHECKOUT, not at print time, so reprinting an
--    invoice never changes its number.
-- ════════════════════════════════════════════════════════════════════════

-- ── per-order tax snapshot ──
ALTER TABLE orders ADD COLUMN IF NOT EXISTS tax_rate   NUMERIC(5,2) NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS cgst       NUMERIC(10,2) NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS sgst       NUMERIC(10,2) NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS invoice_no VARCHAR(40);

-- an invoice number, once issued, must be unique forever
CREATE UNIQUE INDEX IF NOT EXISTS orders_invoice_no_idx
  ON orders (invoice_no) WHERE invoice_no IS NOT NULL;

-- ── sequential invoice series, per financial year ──
CREATE TABLE IF NOT EXISTS invoice_sequences (
  fy          VARCHAR(9) PRIMARY KEY,   -- '2026-27'
  last_number INTEGER NOT NULL DEFAULT 0,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── GST settings (all default to OFF so nothing changes until you register) ──
ALTER TABLE store_settings ADD COLUMN IF NOT EXISTS gst_enabled     BOOLEAN NOT NULL DEFAULT false;
-- 5% is the standard restaurant rate (no input tax credit). Split 2.5 + 2.5.
ALTER TABLE store_settings ADD COLUMN IF NOT EXISTS gst_rate        NUMERIC(5,2) NOT NULL DEFAULT 5;
-- Restaurant GST is normally charged on food only, not on the delivery fee.
ALTER TABLE store_settings ADD COLUMN IF NOT EXISTS gst_on_delivery BOOLEAN NOT NULL DEFAULT false;
-- Menu prices are usually shown GST-inclusive to customers in India.
ALTER TABLE store_settings ADD COLUMN IF NOT EXISTS gst_inclusive   BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE store_settings ADD COLUMN IF NOT EXISTS invoice_prefix  VARCHAR(12) NOT NULL DEFAULT 'BT';
-- HSN 996331 = restaurant/catering services
ALTER TABLE store_settings ADD COLUMN IF NOT EXISTS hsn_code        VARCHAR(12) DEFAULT '996331';
