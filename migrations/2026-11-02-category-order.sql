-- Home page / menu order: Thali, Combos, Starters, Chinese first (own sections
-- at the top), then the à la carte menu, with sweets and sides last.
-- Matches by slug or by name, so it works whether the categories were created
-- by 2026-11-01-storefront-menu.sql or already existed. Change any of this
-- later in Admin -> Categories (Sort number + "Featured on the home page").

UPDATE categories c
   SET sort_order = v.pos,
       featured   = v.featured
  FROM (VALUES
    ('thali',           'Thali',             1,  true),
    ('combos',          'Combos',            2,  true),
    ('starters-fries',  'Starters & Fries',  3,  true),
    ('chinese',         'Chinese',           4,  true),
    ('paneer-specials', 'Paneer Specials',   5,  false),
    ('veg-main-course', 'Veg Main Course',   6,  false),
    ('dal',             'Dal',               7,  false),
    ('rice-biryani',    'Rice & Biryani',    8,  false),
    ('breads',          'Breads',            9,  false),
    ('sides-desserts',  'Sides & Desserts',  10, false)
  ) AS v(slug, name, pos, featured)
 WHERE c.slug = v.slug OR lower(c.name) = lower(v.name);
