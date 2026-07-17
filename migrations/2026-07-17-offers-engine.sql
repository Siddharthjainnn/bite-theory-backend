-- ════════════════════════════════════════════════════════════════════════
-- Offers engine + free-item vouchers.
--
-- WHY A NEW TABLE, given coupons and flash_deals already exist:
--   • coupons     = a CODE the customer must know and type. Great for
--                   marketing, useless for "run 3 timed campaigns on the home
--                   page" because nobody types a code they haven't seen.
--   • flash_deals = ONE storewide % off. Can't run two at once, can't target a
--                   dish, can't give something away free.
--   Offers are the missing middle: multiple, concurrent, time-boxed, visible,
--   and able to gift a FREE ITEM rather than only cutting a price.
--
-- LEGAL NOTE (why free items and not wallet money):
--   Letting a customer load their own cash into a wallet makes it a Prepaid
--   Payment Instrument under RBI rules — that needs a licence, KYC and escrow.
--   Gifting a free dish, or credits YOU issue, is a discount/loyalty scheme and
--   carries none of that. Everything here is the gift side only.
-- ════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS offers (
  id            BIGSERIAL PRIMARY KEY,
  title         VARCHAR(120) NOT NULL,
  subtitle      VARCHAR(200),
  -- 'flat'        ₹X off        -> reward_value = rupees
  -- 'percentage'  X% off        -> reward_value = percent, cap via max_discount
  -- 'free_item'   a free dish   -> free_product_id
  -- 'free_delivery'
  offer_type    VARCHAR(20)  NOT NULL,
  reward_value  NUMERIC(10,2) NOT NULL DEFAULT 0,
  max_discount  NUMERIC(10,2),
  free_product_id BIGINT REFERENCES products(id) ON DELETE SET NULL,

  min_order     NUMERIC(10,2) NOT NULL DEFAULT 0,

  -- the timer the customer sees
  starts_at     TIMESTAMPTZ NOT NULL,
  ends_at       TIMESTAMPTZ NOT NULL,

  -- scarcity + safety
  usage_limit   INTEGER,          -- null = unlimited redemptions overall
  used_count    INTEGER NOT NULL DEFAULT 0,
  per_user_limit INTEGER NOT NULL DEFAULT 1,

  -- presentation
  image_url     VARCHAR(300),
  badge         VARCHAR(30),      -- e.g. 'LIMITED', 'NEW'
  accent        VARCHAR(9) DEFAULT '#F59E0B',
  sort_order    INTEGER NOT NULL DEFAULT 0,

  is_active     BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- a campaign that ends before it starts is always a data-entry mistake
  CONSTRAINT offers_window_valid CHECK (ends_at > starts_at),
  CONSTRAINT offers_type_valid CHECK
    (offer_type IN ('flat','percentage','free_item','free_delivery'))
);

CREATE INDEX IF NOT EXISTS offers_live_idx
  ON offers (starts_at, ends_at) WHERE is_active = true;

-- ── redemptions: one row per use ───────────────────────────────────────
-- A used_count column alone can't answer "has THIS customer already used it?",
-- and can't be reconciled if it drifts. Rows can.
CREATE TABLE IF NOT EXISTS offer_redemptions (
  id         BIGSERIAL PRIMARY KEY,
  offer_id   BIGINT NOT NULL REFERENCES offers(id) ON DELETE CASCADE,
  user_id    BIGINT NOT NULL,
  order_id   BIGINT,
  benefit    NUMERIC(10,2) NOT NULL DEFAULT 0,  -- rupees saved, for reporting
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS offer_redemptions_offer_idx ON offer_redemptions (offer_id);
CREATE INDEX IF NOT EXISTS offer_redemptions_user_idx  ON offer_redemptions (offer_id, user_id);

-- ── wallet → "Bite Coins" (legal framing) ─────────────────────────────
-- Showing "₹500" implies stored money the customer handed over, which is
-- exactly the impression RBI's PPI rules care about. The balance is already
-- gift-only (refunds / referrals / admin credit — no top-up exists), so the
-- risk is the WORDING, not the mechanic. A configurable label lets the store
-- present it as a loyalty balance without touching any money logic.
ALTER TABLE store_settings
  ADD COLUMN IF NOT EXISTS wallet_label VARCHAR(30) NOT NULL DEFAULT 'Wallet';
ALTER TABLE store_settings
  ADD COLUMN IF NOT EXISTS wallet_unit VARCHAR(20) NOT NULL DEFAULT '₹';
ALTER TABLE store_settings
  ADD COLUMN IF NOT EXISTS wallet_note VARCHAR(200)
  DEFAULT 'Credits are issued by Bite Theory as rewards and refunds. They can only be used against orders and cannot be withdrawn or transferred.';
