-- Storefront relaunch: app prices, featured sections, launch banner, opening-day list,
-- and the menu imported from the Zomato menu export (Res ID 22904243, 1 Nov 2026).
--
-- What this does to your data (run once; the runner records it):
--   * 62 dishes from the Zomato list are added, or updated if a dish with the
--     same name already exists (its photo and description are kept).
--       price        = Zomato menu price - 30%, rounded to the rupee (GST inclusive on our site)
--       zomato_price = Zomato menu price (before GST, as Zomato's menu shows it)
--       swiggy_price = same as Zomato for now
--     Change any of these per dish in Admin -> Products.
--   * Every other product is set to INACTIVE (hidden). Nothing is deleted.
--   * Categories: Thali and Combos are "featured" (shown first on the home page),
--     then the full menu. Categories left with no active dish are hidden.
--
-- Schema changes are additive (old code ignores them).

/* ── schema ─────────────────────────────────────────────────────────────── */

ALTER TABLE products ADD COLUMN IF NOT EXISTS zomato_price numeric;
ALTER TABLE products ADD COLUMN IF NOT EXISTS swiggy_price numeric;
ALTER TABLE products ADD COLUMN IF NOT EXISTS toing_price  numeric;
-- order inside a category (lower first); ties fall back to name
ALTER TABLE products ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 0;

-- featured categories get their own section at the top of the home page
ALTER TABLE categories ADD COLUMN IF NOT EXISTS featured boolean NOT NULL DEFAULT false;

-- launch banner, price comparison switch, "also order from" tiles
ALTER TABLE store_settings ADD COLUMN IF NOT EXISTS storefront_config jsonb;

-- customers who tapped "Notify me on opening day"
CREATE TABLE IF NOT EXISTS launch_subscribers (
  id           bigserial PRIMARY KEY,
  phone        varchar(20)  NOT NULL,          -- E.164 digits, e.g. 919876543210
  name         varchar(80),
  user_id      bigint,
  source       varchar(20)  NOT NULL DEFAULT 'home',
  created_at   timestamptz  NOT NULL DEFAULT now(),
  notified_at  timestamptz                     -- opening-day WhatsApp queued
);
CREATE UNIQUE INDEX IF NOT EXISTS launch_subscribers_phone_uq ON launch_subscribers (phone);
CREATE INDEX IF NOT EXISTS launch_subscribers_pending_idx ON launch_subscribers (id) WHERE notified_at IS NULL;

/* ── id sequences: rows added with explicit ids leave the sequence behind,
      which makes the next INSERT collide. Move each past the highest id. ── */
SELECT setval(pg_get_serial_sequence('categories', 'id'), GREATEST((SELECT COALESCE(MAX(id), 0) FROM categories), 1));
SELECT setval(pg_get_serial_sequence('products', 'id'),   GREATEST((SELECT COALESCE(MAX(id), 0) FROM products), 1));

/* ── categories ─────────────────────────────────────────────────────────── */

DROP TABLE IF EXISTS _bt_cats;
CREATE TEMP TABLE _bt_cats (slug text, name text, pos int, featured boolean, id bigint);
INSERT INTO _bt_cats (slug, name, pos, featured) VALUES
  ('thali',           'Thali',              1,  true),
  ('combos',          'Combos',             2,  true),
  ('paneer-specials', 'Paneer Specials',    3,  false),
  ('veg-main-course', 'Veg Main Course',    4,  false),
  ('dal',             'Dal',                5,  false),
  ('rice-biryani',    'Rice & Biryani',     6,  false),
  ('breads',          'Breads',             7,  false),
  ('chinese',         'Chinese',            8,  false),
  ('starters-fries',  'Starters & Fries',   9,  false),
  ('sides-desserts',  'Sides & Desserts',   10, false);

-- reuse an existing category with the same slug or name (keeps its image)
UPDATE _bt_cats k SET id = (
  SELECT c.id FROM categories c
   WHERE c.slug = k.slug OR lower(c.name) = lower(k.name)
   ORDER BY (c.slug = k.slug) DESC, c.id LIMIT 1);

INSERT INTO categories (name, slug, sort_order, is_active, featured)
SELECT k.name, k.slug, k.pos, true, k.featured FROM _bt_cats k WHERE k.id IS NULL;

UPDATE _bt_cats k SET id = c.id FROM categories c WHERE k.id IS NULL AND c.slug = k.slug;

UPDATE categories c SET sort_order = k.pos, featured = k.featured, is_active = true
  FROM _bt_cats k WHERE c.id = k.id;

-- every other category goes after ours, keeping its relative order
UPDATE categories SET sort_order = sort_order + 100, featured = false
 WHERE id NOT IN (SELECT id FROM _bt_cats);

/* ── menu (Zomato menu price, before GST) ───────────────────────────────── */

DROP TABLE IF EXISTS _bt_menu;
CREATE TEMP TABLE _bt_menu (name text, cat text, zomato numeric, pos int);
INSERT INTO _bt_menu (name, cat, zomato, pos) VALUES
  -- thali
  ('Special Thali',             'thali',           139, 1),
  ('Bites Theory Shahi Thali',  'thali',           169, 2),
  -- combos
  ('Bhindi Masala + 4 Roti',    'combos',           99, 1),
  ('Gobi Masala + 4 Roti',      'combos',           99, 2),
  ('Mix Veg + 4 Roti',          'combos',           99, 3),
  ('Sev Tamatar + 4 Roti',      'combos',           99, 4),
  ('Aloo Matar Combo',          'combos',           99, 5),
  ('Chole Rice Combo',          'combos',           99, 6),
  ('Rajma Rice Combo',          'combos',           99, 7),
  ('Paneer Sabzi Combo',        'combos',          109, 8),
  -- paneer specials
  ('Punjabi Paneer',            'paneer-specials', 220, 1),
  ('Paneer Pasanda',            'paneer-specials', 220, 2),
  ('Shahi Paneer',              'paneer-specials', 220, 3),
  ('Paneer Do Pyaaza',          'paneer-specials', 220, 4),
  ('Palak Paneer',              'paneer-specials', 220, 5),
  ('Paneer Lababdar',           'paneer-specials', 220, 6),
  ('Paneer Kolhapuri',          'paneer-specials', 229, 7),
  ('Kadai Paneer',              'paneer-specials', 229, 8),
  -- veg main course
  ('Jeera Aloo',                'veg-main-course', 199, 1),
  ('Dum Aloo',                  'veg-main-course', 199, 2),
  ('Bhindi Do Pyaaza',          'veg-main-course', 199, 3),
  ('Mushroom Masala',           'veg-main-course', 170, 4),
  ('Bhindi Masala',             'veg-main-course', 168, 5),
  ('Veg Makhanwala',            'veg-main-course', 199, 6),
  ('Navratan Korma',            'veg-main-course', 199, 7),
  ('Veg Kolhapuri',             'veg-main-course', 199, 8),
  ('Corn Capsicum Masala',      'veg-main-course', 220, 9),
  ('Green Garden',              'veg-main-course', 220, 10),
  ('Corn Palak',                'veg-main-course', 199, 11),
  ('Malai Kofta',               'veg-main-course', 220, 12),
  ('Mix Veg',                   'veg-main-course', 168, 13),
  ('Sev Tamatar',               'veg-main-course', 199, 14),
  -- dal
  ('Dal Hariyali',              'dal',             178, 1),
  ('Dal Punjabi',               'dal',             178, 2),
  ('Dal Makhani',               'dal',             188, 3),
  ('Dal Tadka',                 'dal',             178, 4),
  ('Dal Fry',                   'dal',             188, 5),
  -- rice & biryani
  ('Butter Khichdi',            'rice-biryani',    100, 1),
  ('Green Peas Pulao',          'rice-biryani',    149, 2),
  ('Veg Pulao',                 'rice-biryani',    170, 3),
  ('Jeera Rice',                'rice-biryani',    159, 4),
  ('Plain Rice',                'rice-biryani',    149, 5),
  ('Hyderabadi Biryani',        'rice-biryani',    200, 6),
  -- breads
  ('Butter Tawa Roti',          'breads',           20, 1),
  ('Tawa Roti',                 'breads',           15, 2),
  -- chinese
  ('Veg Hakka Noodles',         'chinese',         139, 1),
  ('Schezwan Noodles',          'chinese',         139, 2),
  ('Chilli Garlic Noodles',     'chinese',         149, 3),
  ('Veg Fried Rice',            'chinese',         149, 4),
  ('Schezwan Fried Rice',       'chinese',         149, 5),
  ('Paneer Fried Rice',         'chinese',         139, 6),
  ('Veg Manchurian Dry',        'chinese',         140, 7),
  ('Veg Manchurian Gravy',      'chinese',         140, 8),
  ('Chilli Paneer Dry',         'chinese',         149, 9),
  ('Chilli Paneer Gravy',       'chinese',         149, 10),
  -- starters & fries
  ('Honey Chilli Potato',       'starters-fries',  149, 1),
  ('Crispy Corn',               'starters-fries',  149, 2),
  ('Veg Rice Stick (6 pcs)',    'starters-fries',  150, 3),
  ('Salted French Fries',       'starters-fries',  120, 4),
  ('Peri Peri Fries',           'starters-fries',  129, 5),
  -- sides & desserts
  ('Fresh Boondi Raita (400 ml)', 'sides-desserts', 68, 1),
  ('Gulab Jamun',               'sides-desserts',   30, 2);

-- the URL name each new dish would get ("Sev Tamatar + 4 Roti" -> "sev-tamatar-4-roti")
ALTER TABLE _bt_menu ADD COLUMN slug text;
UPDATE _bt_menu SET slug = trim(both '-' from regexp_replace(lower(name), '[^a-z0-9]+', '-', 'g'));

-- existing dish with the same name: update it in place (photo, description, nutrition kept)
UPDATE products p
   SET category_id  = k.id,
       price        = round(m.zomato * 0.7),
       offer_price  = NULL,
       zomato_price = m.zomato,
       swiggy_price = m.zomato,
       sort_order   = m.pos,
       status       = 'active',
       updated_at   = now()
  FROM _bt_menu m JOIN _bt_cats k ON k.slug = m.cat
 WHERE lower(trim(p.name)) = lower(m.name);

-- existing dish written slightly differently but with the same URL name
-- (e.g. "Sev Tamatar + (4 Roti)"): it is the same dish, so take the new name
-- and update it in place, instead of adding a duplicate (slugs are unique)
UPDATE products p
   SET name         = m.name,
       category_id  = k.id,
       price        = round(m.zomato * 0.7),
       offer_price  = NULL,
       zomato_price = m.zomato,
       swiggy_price = m.zomato,
       sort_order   = m.pos,
       status       = 'active',
       updated_at   = now()
  FROM _bt_menu m JOIN _bt_cats k ON k.slug = m.cat
 WHERE p.slug = m.slug
   AND NOT EXISTS (SELECT 1 FROM products q WHERE lower(trim(q.name)) = lower(m.name));

-- new dishes
INSERT INTO products (category_id, name, slug, price, zomato_price, swiggy_price, sort_order, status, is_veg)
SELECT k.id, m.name, m.slug,
       round(m.zomato * 0.7), m.zomato, m.zomato, m.pos, 'active', true
  FROM _bt_menu m JOIN _bt_cats k ON k.slug = m.cat
 WHERE NOT EXISTS (SELECT 1 FROM products p WHERE lower(trim(p.name)) = lower(m.name))
   AND NOT EXISTS (SELECT 1 FROM products p WHERE p.slug = m.slug);

-- everything not on the new menu is hidden (not deleted)
UPDATE products SET status = 'inactive', updated_at = now()
 WHERE lower(trim(name)) NOT IN (SELECT lower(name) FROM _bt_menu)
   AND status <> 'inactive';

-- hide categories that now have nothing to show
UPDATE categories c SET is_active = false
 WHERE c.id NOT IN (SELECT id FROM _bt_cats)
   AND NOT EXISTS (SELECT 1 FROM products p WHERE p.category_id = c.id AND p.status <> 'inactive');

DROP TABLE IF EXISTS _bt_menu;
DROP TABLE IF EXISTS _bt_cats;
