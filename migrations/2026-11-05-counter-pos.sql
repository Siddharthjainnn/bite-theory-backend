-- ════════════════════════════════════════════════════════════════════════
-- Counter POS for the walk-in outlets (Bhawarkua first).
--
-- What this adds
--  * outlets          — each physical counter: its own address / GSTIN on the
--                       bill, its own bill-number series, its own day.
--  * outlet_prices    — the rate list. A row only where the outlet differs
--                       from the website price (or hides a dish). No row =
--                       sell at the website price.
--  * pos_bills        — every counter bill, saved BEFORE anything is printed,
--    pos_bill_items     with prices and tax frozen at the moment of sale.
--  * pos_counters     — row-locked counters for the daily 3-digit token and
--                       the yearly bill-number series (never MAX()+1: two
--                       counters billing at once would get the same number).
--
-- Why counter bills are NOT rows in `orders`
--   `orders` drives Live Orders, riders, customer history, WhatsApp and
--   delivery reports. A walk-in bill would show up as a delivery to assign.
--   Counter sales get their own tables and their own reports instead.
--
-- Rules the database itself enforces
--  * A bill number is unique forever (GST: one unbroken series per outlet
--    per financial year, max 16 characters, e.g. BKW/26-27/000001).
--  * Bills are never deleted — a mistake is CANCELLED with a reason, stays in
--    the series, and shows on the report.
--  * A double-click can't make two bills: the till sends a client_ref and a
--    repeat of the same ref returns the bill already made.
--
-- Idempotent: safe to run again.
-- ════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS outlets (
  id            SERIAL PRIMARY KEY,
  code          VARCHAR(3)  NOT NULL,          -- 'BKW' — starts every bill number
  name          VARCHAR(80) NOT NULL,          -- 'Bhawarkua'
  address       TEXT,
  phone         VARCHAR(20),
  gstin         VARCHAR(15),
  fssai         VARCHAR(20),
  bill_footer   TEXT,
  -- The business day starts at this hour (India time). 4 = a bill at 1:30 am
  -- still counts for "yesterday", and tokens restart at 4 am, not midnight.
  day_starts_at SMALLINT    NOT NULL DEFAULT 4,
  -- what the big Print button does: bill + kitchen ticket, bill only, KOT only
  print_mode    VARCHAR(8)  NOT NULL DEFAULT 'both',
  kot_copies    SMALLINT    NOT NULL DEFAULT 1,
  is_active     BOOLEAN     NOT NULL DEFAULT true,
  sort_order    INTEGER     NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT outlets_code_chk  CHECK (code ~ '^[A-Z0-9]{2,3}$'),
  CONSTRAINT outlets_day_chk   CHECK (day_starts_at BETWEEN 0 AND 23),
  CONSTRAINT outlets_print_chk CHECK (print_mode IN ('both', 'bill', 'kot')),
  CONSTRAINT outlets_kot_chk   CHECK (kot_copies BETWEEN 1 AND 3)
);
CREATE UNIQUE INDEX IF NOT EXISTS outlets_code_idx ON outlets (code);

CREATE TABLE IF NOT EXISTS outlet_prices (
  outlet_id    INTEGER NOT NULL REFERENCES outlets(id) ON DELETE CASCADE,
  product_id   BIGINT  NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  price        NUMERIC(10,2),                  -- NULL = sell at the website price
  is_available BOOLEAN NOT NULL DEFAULT true,  -- false = not sold at this counter
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (outlet_id, product_id),
  CONSTRAINT outlet_prices_price_chk CHECK (price IS NULL OR price > 0)
);

CREATE TABLE IF NOT EXISTS pos_counters (
  outlet_id   INTEGER     NOT NULL REFERENCES outlets(id) ON DELETE CASCADE,
  scope       VARCHAR(24) NOT NULL,            -- 'token:2026-11-21' | 'bill:26-27'
  last_number INTEGER     NOT NULL DEFAULT 0,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (outlet_id, scope)
);

CREATE TABLE IF NOT EXISTS pos_bills (
  id              BIGSERIAL PRIMARY KEY,
  outlet_id       INTEGER      NOT NULL REFERENCES outlets(id),
  bill_no         VARCHAR(16)  NOT NULL,
  token_no        SMALLINT     NOT NULL,
  business_date   DATE         NOT NULL,
  order_type      VARCHAR(10)  NOT NULL DEFAULT 'takeaway',
  customer_name   VARCHAR(80),
  customer_mobile VARCHAR(10),
  note            VARCHAR(300),
  item_count      INTEGER      NOT NULL,
  subtotal        NUMERIC(10,2) NOT NULL,
  discount        NUMERIC(10,2) NOT NULL DEFAULT 0,
  discount_reason VARCHAR(80),
  taxable_amount  NUMERIC(10,2) NOT NULL,
  tax_rate        NUMERIC(5,2)  NOT NULL DEFAULT 0,
  cgst            NUMERIC(10,2) NOT NULL DEFAULT 0,
  sgst            NUMERIC(10,2) NOT NULL DEFAULT 0,
  gst_inclusive   BOOLEAN       NOT NULL DEFAULT true,
  round_off       NUMERIC(6,2)  NOT NULL DEFAULT 0,
  total           NUMERIC(10,2) NOT NULL,
  payment_method  VARCHAR(8)   NOT NULL,
  status          VARCHAR(10)  NOT NULL DEFAULT 'paid',
  cancel_reason   VARCHAR(200),
  cancelled_at    TIMESTAMPTZ,
  cancelled_by    VARCHAR(120),
  cashier_id      INTEGER,
  cashier_name    VARCHAR(120),
  client_ref      UUID,
  print_count     INTEGER      NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT pos_bills_type_chk   CHECK (order_type IN ('takeaway', 'dine_in')),
  CONSTRAINT pos_bills_pay_chk    CHECK (payment_method IN ('cash', 'upi', 'card', 'other')),
  CONSTRAINT pos_bills_status_chk CHECK (status IN ('paid', 'cancelled')),
  CONSTRAINT pos_bills_token_chk  CHECK (token_no BETWEEN 1 AND 999),
  CONSTRAINT pos_bills_money_chk  CHECK (subtotal >= 0 AND discount >= 0 AND discount <= subtotal AND total >= 0)
);
CREATE UNIQUE INDEX IF NOT EXISTS pos_bills_no_idx  ON pos_bills (bill_no);
CREATE UNIQUE INDEX IF NOT EXISTS pos_bills_ref_idx ON pos_bills (outlet_id, client_ref) WHERE client_ref IS NOT NULL;
CREATE INDEX IF NOT EXISTS pos_bills_day_idx ON pos_bills (outlet_id, business_date);
CREATE INDEX IF NOT EXISTS pos_bills_date_idx ON pos_bills (business_date);

CREATE TABLE IF NOT EXISTS pos_bill_items (
  id            BIGSERIAL PRIMARY KEY,
  bill_id       BIGINT       NOT NULL REFERENCES pos_bills(id) ON DELETE CASCADE,
  -- no FK: a dish deleted from the menu next year must not touch old bills
  product_id    BIGINT,
  product_name  VARCHAR(160) NOT NULL,
  category_name VARCHAR(80),
  is_veg        BOOLEAN,
  unit_price    NUMERIC(10,2) NOT NULL,
  quantity      INTEGER      NOT NULL,
  line_total    NUMERIC(10,2) NOT NULL,
  CONSTRAINT pos_bill_items_qty_chk CHECK (quantity > 0 AND quantity <= 999)
);
CREATE INDEX IF NOT EXISTS pos_bill_items_bill_idx ON pos_bill_items (bill_id);
CREATE INDEX IF NOT EXISTS pos_bill_items_product_idx ON pos_bill_items (product_id);

-- ── first outlet ──
INSERT INTO outlets (code, name, address, sort_order)
SELECT 'BKW', 'Bhawarkua', 'Bhawarkua, Indore, Madhya Pradesh', 1
WHERE NOT EXISTS (SELECT 1 FROM outlets WHERE code = 'BKW');

-- ── a Cashier role that can only open the counter ──
-- (key 'cashier'; give counter staff this role in Admin → Admin Users)
INSERT INTO roles (name, description, sections)
SELECT 'cashier', 'Counter staff — billing only', '["pos"]'::jsonb
WHERE NOT EXISTS (
  SELECT 1 FROM roles WHERE lower(replace(trim(name), ' ', '_')) = 'cashier');
