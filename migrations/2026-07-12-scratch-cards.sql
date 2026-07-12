-- Scratch card after every delivered order. Reward decided SERVER-SIDE at
-- creation; the scratch action only reveals + pays out (idempotent).
CREATE TABLE IF NOT EXISTS scratch_cards (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL,
  order_id BIGINT NOT NULL UNIQUE,
  reward_type VARCHAR NOT NULL,   -- 'cashback' | 'better_luck'
  reward_value NUMERIC NOT NULL DEFAULT 0,
  scratched BOOLEAN NOT NULL DEFAULT false,
  scratched_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);
