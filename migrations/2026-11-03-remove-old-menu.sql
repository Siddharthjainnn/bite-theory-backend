-- Remove the old menu for good, without touching anyone's order history.
--
--   DELETED: every old dish (hidden by 2026-11-01-storefront-menu.sql) that no
--            past order points at, together with its reviews, favourites and
--            stock row; then every old category that has no dish left.
--   KEPT (hidden): an old dish that appears in a past order. Deleting it would
--            break that customer's order history and invoice, so it stays
--            inactive and never shows on the site.
--   NOT TOUCHED: customers, addresses, orders, payments, wallet, points.
--
-- "Old" = not one of the 62 dishes on the new menu (matched by name).
-- Each delete runs in its own savepoint: if your database has a link this file
-- doesn't know about, that one dish is simply kept (hidden) instead of failing.

DO $$
DECLARE
  menu text[] := ARRAY[
    'special thali','bites theory shahi thali',
    'bhindi masala + 4 roti','gobi masala + 4 roti','mix veg + 4 roti','sev tamatar + 4 roti',
    'aloo matar combo','chole rice combo','rajma rice combo','paneer sabzi combo',
    'punjabi paneer','paneer pasanda','shahi paneer','paneer do pyaaza','palak paneer',
    'paneer lababdar','paneer kolhapuri','kadai paneer',
    'jeera aloo','dum aloo','bhindi do pyaaza','mushroom masala','bhindi masala','veg makhanwala',
    'navratan korma','veg kolhapuri','corn capsicum masala','green garden','corn palak',
    'malai kofta','mix veg','sev tamatar',
    'dal hariyali','dal punjabi','dal makhani','dal tadka','dal fry',
    'butter khichdi','green peas pulao','veg pulao','jeera rice','plain rice','hyderabadi biryani',
    'butter tawa roti','tawa roti',
    'veg hakka noodles','schezwan noodles','chilli garlic noodles','veg fried rice',
    'schezwan fried rice','paneer fried rice','veg manchurian dry','veg manchurian gravy',
    'chilli paneer dry','chilli paneer gravy',
    'honey chilli potato','crispy corn','veg rice stick (6 pcs)','salted french fries','peri peri fries',
    'fresh boondi raita (400 ml)','gulab jamun'
  ];
  keep_cats text[] := ARRAY['thali','combos','starters-fries','chinese','paneer-specials',
    'veg-main-course','dal','rice-biryani','breads','sides-desserts'];
  r record;
  removed int := 0;
  kept int := 0;
BEGIN
  FOR r IN
    SELECT p.id FROM products p
     WHERE lower(trim(p.name)) <> ALL (menu)
  LOOP
    IF EXISTS (SELECT 1 FROM order_items oi WHERE oi.product_id = r.id) THEN
      UPDATE products SET status = 'inactive' WHERE id = r.id;
      kept := kept + 1;
      CONTINUE;
    END IF;
    BEGIN
      DELETE FROM reviews   WHERE product_id = r.id;
      DELETE FROM favorites WHERE product_id = r.id;
      DELETE FROM inventory WHERE product_id = r.id;
      DELETE FROM products  WHERE id = r.id;
      removed := removed + 1;
    EXCEPTION WHEN foreign_key_violation THEN
      UPDATE products SET status = 'inactive' WHERE id = r.id;
      kept := kept + 1;
    END;
  END LOOP;
  RAISE NOTICE 'Old dishes deleted: %, kept hidden (in past orders): %', removed, kept;

  removed := 0;
  FOR r IN
    SELECT c.id FROM categories c
     WHERE c.slug <> ALL (keep_cats)
       AND NOT EXISTS (SELECT 1 FROM products p WHERE p.category_id = c.id)
  LOOP
    BEGIN
      DELETE FROM categories WHERE id = r.id;
      removed := removed + 1;
    EXCEPTION WHEN foreign_key_violation THEN
      UPDATE categories SET is_active = false WHERE id = r.id;
    END;
  END LOOP;
  RAISE NOTICE 'Old categories deleted: %', removed;
END $$;
