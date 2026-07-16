-- ════════════════════════════════════════════════════════════════════════
-- Help Centre — normalized, admin-managed FAQ.
--
-- Replaces a hard-coded FAQS array that lived inside the support page: every
-- wording tweak needed a developer and a deploy, and nobody could see which
-- questions customers actually struggle with.
--
-- Design (3NF):
--   faq_categories  1 ──< faq_articles  1 ──< faq_feedback
--
-- Why feedback is its own TABLE and not a counter column:
--   a counter can only ever say "12 people found this useful". A row per vote
--   tells you WHICH article is failing, WHEN it started failing (e.g. right
--   after a price change), and lets you dedupe per user. Counters lie; events
--   don't. The counts are then derived, never stored twice.
-- ════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS faq_categories (
  id          BIGSERIAL PRIMARY KEY,
  name        VARCHAR(80)  NOT NULL,
  slug        VARCHAR(80)  NOT NULL UNIQUE,
  icon        VARCHAR(16),                       -- emoji shown in the list
  description TEXT,
  sort_order  INTEGER      NOT NULL DEFAULT 0,
  is_active   BOOLEAN      NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS faq_articles (
  id           BIGSERIAL PRIMARY KEY,
  category_id  BIGINT       NOT NULL REFERENCES faq_categories(id) ON DELETE RESTRICT,
  question     TEXT         NOT NULL,
  answer       TEXT         NOT NULL,
  -- optional deep-link, e.g. /orders — turns an answer into an action
  action_label VARCHAR(60),
  action_url   VARCHAR(200),
  keywords     TEXT,                             -- extra search terms
  sort_order   INTEGER      NOT NULL DEFAULT 0,
  is_active    BOOLEAN      NOT NULL DEFAULT true,
  view_count   INTEGER      NOT NULL DEFAULT 0,  -- denormalized on purpose:
                                                 -- a view event table would be
                                                 -- huge and is not worth it
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS faq_articles_category_idx
  ON faq_articles(category_id, sort_order);
CREATE INDEX IF NOT EXISTS faq_articles_active_idx
  ON faq_articles(is_active);

CREATE TABLE IF NOT EXISTS faq_feedback (
  id         BIGSERIAL PRIMARY KEY,
  article_id BIGINT      NOT NULL REFERENCES faq_articles(id) ON DELETE CASCADE,
  user_id    BIGINT,                              -- null = signed-out visitor
  helpful    BOOLEAN     NOT NULL,
  comment    TEXT,                                -- only asked for on "no"
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- one vote per user per article; re-voting UPDATEs instead of stacking
CREATE UNIQUE INDEX IF NOT EXISTS faq_feedback_one_per_user_idx
  ON faq_feedback(article_id, user_id) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS faq_feedback_article_idx
  ON faq_feedback(article_id);

-- ── seed: the questions customers actually ask ──
INSERT INTO faq_categories (name, slug, icon, description, sort_order) VALUES
  ('Orders & Delivery', 'orders',   '📦', 'Tracking, ETA, OTP and delivery issues', 1),
  ('Payments',          'payments', '💳', 'Paying, failed payments and charges',    2),
  ('Refunds & Wallet',  'refunds',  '↩️', 'Refunds, wallet balance and rewards',    3),
  ('Offers & Coupons',  'offers',   '🎟️', 'Coupons, discounts and referrals',       4),
  ('Food & Menu',       'food',     '🍱', 'Dishes, allergens and customisation',    5),
  ('Account',           'account',  '👤', 'Profile, addresses and login',           6)
ON CONFLICT (slug) DO NOTHING;

INSERT INTO faq_articles (category_id, question, answer, action_label, action_url, sort_order)
SELECT c.id, v.q, v.a, v.al, v.au, v.so
FROM (VALUES
  ('orders', 'Where is my order?',
   'Open Orders and tap your live order. You will see the current status, a live map once the rider picks it up, and an ETA. If it has been stuck on one status for more than 20 minutes, please call us.',
   'Track my order', '/orders', 1),
  ('orders', 'The rider is asking for an OTP — where do I find it?',
   'It is on your order tracking screen: open Orders and tap the live order. Share the 4-digit code with the rider only after you have received your food — it is what confirms the delivery.',
   'Open Orders', '/orders', 2),
  ('orders', 'The kitchen is closed / I cannot place an order',
   'We cook everything to order, so ordering is only open during kitchen hours — the home screen shows the next opening time. You may also be outside our delivery radius, which the app tells you at checkout.',
   NULL, NULL, 3),
  ('orders', 'Can I change or cancel my order?',
   'You can cancel from the order screen while it is still being prepared. Once the food is out for delivery it cannot be cancelled. To change items, cancel and reorder — or call us quickly and we will try to help.',
   'My orders', '/orders', 4),
  ('payments', 'I paid but my order did not go through',
   'Check Orders first — if the order is there, you are fine. If money left your account and no order appeared, it is almost always auto-reversed by your bank within 5-7 working days. Raise a ticket with the amount and time and we will trace it.',
   'Check Orders', '/orders', 1),
  ('payments', 'What payment methods can I use?',
   'UPI (GPay, PhonePe, Paytm), cards, and cash on delivery. You can also pay part of any order with your wallet balance.',
   NULL, NULL, 2),
  ('refunds', 'When will my refund arrive?',
   'Refunds go back to your original payment method the same day we process them. Banks usually take 5-7 working days to show it. Refunds to your Bite Theory wallet are instant.',
   'My wallet', '/account/wallet', 1),
  ('refunds', 'How do I use my wallet balance?',
   'At checkout, turn on "Use wallet balance" and it applies to that order automatically. Wallet money comes from refunds, referrals and rewards.',
   'My wallet', '/account/wallet', 2),
  ('offers', 'My coupon is not applying',
   'Check three things: your order meets the coupon minimum, the coupon has not expired, and you have not already used it. The cart shows the exact reason under the coupon box when a code is rejected.',
   'View coupons', '/coupons', 1),
  ('offers', 'How does Refer & Earn work?',
   'Share your referral code from the Refer & Earn screen. When a friend signs up with it and completes their first order, you both get wallet credit.',
   'Refer a friend', '/account/referrals', 2),
  ('food', 'Something was missing or wrong in my order',
   'We are sorry — raise a ticket below with your order number and what was wrong. A photo helps. We review these quickly and refund where it is our mistake.',
   NULL, NULL, 1),
  ('food', 'Is all your food vegetarian?',
   'Yes — Bite Theory is 100% pure veg. Every dish, every day.',
   'See the menu', '/menu', 2),
  ('account', 'How do I add or change my delivery address?',
   'Go to Profile then Saved Addresses to add, edit or remove addresses. You can also add a new address during checkout.',
   'My addresses', '/account/addresses', 1),
  ('account', 'How do I update my name or mobile number?',
   'Open Profile and tap Edit under Personal details.',
   'My profile', '/account/profile', 2)
) AS v(cat, q, a, al, au, so)
JOIN faq_categories c ON c.slug = v.cat
WHERE NOT EXISTS (SELECT 1 FROM faq_articles fa WHERE fa.question = v.q);
