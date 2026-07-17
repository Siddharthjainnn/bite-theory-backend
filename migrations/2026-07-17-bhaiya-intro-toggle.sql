-- Ask Bhaiya intro: admin-controlled auto-show.
--
-- The goal-picker intro was hardcoded to pop up once per day for every
-- customer. That's a product decision baked into code — the admin had no way
-- to turn it off if it annoyed people, or on for a campaign, without a deploy.
--
-- Default TRUE so behaviour is unchanged for anyone who never touches it.
--
-- Note this only controls the AUTOMATIC popup. The "Ask Bhaiya" button in the
-- header always works — turning this off makes the feature opt-in rather than
-- removing it.
ALTER TABLE store_settings
  ADD COLUMN IF NOT EXISTS bhaiya_intro_enabled BOOLEAN NOT NULL DEFAULT true;

-- How often the intro may re-appear for the same customer.
--   'daily'   – once per day (current behaviour)
--   'once'    – once ever, then never again
--   'always'  – every visit (useful for a launch week)
ALTER TABLE store_settings
  ADD COLUMN IF NOT EXISTS bhaiya_intro_frequency VARCHAR(10) NOT NULL DEFAULT 'daily';
