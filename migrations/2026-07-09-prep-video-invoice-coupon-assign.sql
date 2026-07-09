-- Bite Theory: prep-video-with-order + admin coupon assignment + customizable invoice layout
-- Idempotent — safe to run multiple times on Neon/Render Postgres.

-- ─────────────────────────────────────────────────────────────
-- 1) PREP VIDEO WITH ORDER (signature feature)
--    A short "your food being made" clip the admin attaches to a specific
--    order; the customer sees it on the tracking page.
-- ─────────────────────────────────────────────────────────────
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS prep_video_url text;

-- ─────────────────────────────────────────────────────────────
-- 2) ADMIN-ASSIGNED COUPONS
--    Admin gifts a coupon to a specific user. When that user checks out,
--    an assigned+unused coupon is honoured even if the global usage limit
--    is hit, and (optionally) auto-suggested in their coupon list.
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS coupon_assignments (
  id          bigserial PRIMARY KEY,
  coupon_id   bigint NOT NULL,
  user_id     bigint NOT NULL,
  note        text,
  is_used     boolean NOT NULL DEFAULT false,
  order_id    bigint,                    -- set when redeemed
  created_at  timestamptz NOT NULL DEFAULT now(),
  used_at     timestamptz,
  UNIQUE (coupon_id, user_id)            -- one live assignment per (coupon,user)
);
CREATE INDEX IF NOT EXISTS idx_coupon_assign_user
  ON coupon_assignments (user_id, is_used);

-- ─────────────────────────────────────────────────────────────
-- 3) CUSTOMIZABLE INVOICE / BILL LAYOUT
--    Single JSONB blob on the settings row the admin edits from the panel.
--    Controls branding, which columns show, footer text, thermal width, etc.
--    Kept nullable so existing rows keep working; code supplies defaults.
-- ─────────────────────────────────────────────────────────────
ALTER TABLE store_settings
  ADD COLUMN IF NOT EXISTS invoice_config jsonb;
