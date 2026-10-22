-- WhatsApp notifications (Meta WhatsApp Business Platform, Cloud API).
-- Customers get order updates; the owner and staff get kitchen alerts.
-- Idempotent and additive: safe to re-run, old code ignores it.

-- Every message goes through this outbox. The order flow only INSERTs a row
-- (fast, can't fail on a WhatsApp outage); a background sender delivers it,
-- retries failures, and records what Meta reported back.
CREATE TABLE IF NOT EXISTS notification_outbox (
  id            bigserial PRIMARY KEY,
  channel       varchar(16)  NOT NULL DEFAULT 'whatsapp',
  audience      varchar(12)  NOT NULL,              -- 'customer' | 'staff'
  to_phone      varchar(20)  NOT NULL,              -- E.164 digits, e.g. 919876543210
  template      varchar(64)  NOT NULL,
  params        jsonb        NOT NULL DEFAULT '[]', -- body variables, in order
  order_id      bigint,
  kind          varchar(40)  NOT NULL,              -- order_placed, status:out_for_delivery, alert:not_accepted ...
  dedupe_key    varchar(160) NOT NULL,              -- same key = same message, never sent twice
  status        varchar(12)  NOT NULL DEFAULT 'pending', -- pending, sending, sent, delivered, read, failed, skipped
  attempts      integer      NOT NULL DEFAULT 0,
  next_try_at   timestamptz  NOT NULL DEFAULT now(),
  last_error    text,
  provider_id   varchar(128),                       -- Meta message id (wamid)
  created_at    timestamptz  NOT NULL DEFAULT now(),
  sent_at       timestamptz,
  updated_at    timestamptz  NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_outbox_dedupe ON notification_outbox (dedupe_key);
CREATE INDEX IF NOT EXISTS idx_outbox_due ON notification_outbox (next_try_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_outbox_provider ON notification_outbox (provider_id) WHERE provider_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_outbox_recent ON notification_outbox (created_at DESC);

-- Customer opted out (replied STOP). Order updates on WhatsApp stop; in-app
-- notifications and email are unaffected.
ALTER TABLE users ADD COLUMN IF NOT EXISTS whatsapp_opt_out boolean NOT NULL DEFAULT false;

-- Who gets what, and when (staff numbers, alert thresholds). Shape + defaults:
-- src/notify/notify.config.ts. Off until an admin turns it on.
ALTER TABLE store_settings ADD COLUMN IF NOT EXISTS notify_config jsonb;
