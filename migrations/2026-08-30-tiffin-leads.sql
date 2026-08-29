-- Tiffin / daily-meal enrolment funnel (Meta ad landing page).
-- Captures a callback lead, not a live subscription: admin phones the customer
-- back, takes payment offline, then marks the lead converted.
CREATE TABLE IF NOT EXISTS tiffin_leads (
  id          bigserial PRIMARY KEY,
  user_id     bigint,
  name        varchar NOT NULL,
  phone       varchar NOT NULL,
  email       varchar,
  area        varchar,
  plan_key    varchar,
  plan_label  varchar,
  plan_price  integer,
  schedule    jsonb,
  notes       text,
  status      varchar NOT NULL DEFAULT 'new',
  admin_note  text,
  source      varchar,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz
);

-- Admin list is always "newest first, filtered by pipeline status".
CREATE INDEX IF NOT EXISTS idx_tiffin_leads_status_id ON tiffin_leads (status, id DESC);
-- Backs the 10-minute duplicate-submission guard in TiffinService.create().
CREATE INDEX IF NOT EXISTS idx_tiffin_leads_phone ON tiffin_leads (phone);
