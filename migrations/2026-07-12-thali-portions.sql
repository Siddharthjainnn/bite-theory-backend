-- Thali v2: portion-based pricing.
-- The thali starts at base_price (set it to 0 for a fully à la carte thali)
-- and every option is priced PER PORTION (extra_price = unit price).
-- max_qty = how many portions of one option a user may add (admin decides:
-- roti max 6, gulab jamun max 4, sabzi max 2...).
-- Section min_select / max_select now count TOTAL PORTIONS in that section.

ALTER TABLE thali_options ADD COLUMN IF NOT EXISTS max_qty INT NOT NULL DEFAULT 1;
