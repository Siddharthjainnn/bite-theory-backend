-- Customize Thali (Feature 1.4): admin-configurable thali builder.
--
-- A template is the thali "shell" (base price). It has sections
-- ("Sabzi", "Dal", "Roti/Rice", "Extras"), each with min/max picks.
-- Sections have options; options can carry a premium (extra_price) and a
-- daily availability switch ("bhindi khatam" → toggle off, instantly gone).
--
-- Order snapshots: a customized thali is stored on the order item as JSON
-- (order_items.thali_config) so kitchen slips/invoices show exactly what to
-- make, and history stays truthful when options change later.

CREATE TABLE IF NOT EXISTS thali_templates (
  id BIGSERIAL PRIMARY KEY,
  name VARCHAR NOT NULL,
  base_price NUMERIC NOT NULL,
  image TEXT,
  status VARCHAR NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS thali_sections (
  id BIGSERIAL PRIMARY KEY,
  template_id BIGINT NOT NULL REFERENCES thali_templates(id) ON DELETE CASCADE,
  name VARCHAR NOT NULL,
  min_select INT NOT NULL DEFAULT 1,
  max_select INT NOT NULL DEFAULT 1,
  sort_order INT NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS thali_options (
  id BIGSERIAL PRIMARY KEY,
  section_id BIGINT NOT NULL REFERENCES thali_sections(id) ON DELETE CASCADE,
  name VARCHAR NOT NULL,
  extra_price NUMERIC NOT NULL DEFAULT 0,
  calories INT,
  protein NUMERIC,
  image TEXT,
  is_available BOOLEAN NOT NULL DEFAULT true,
  sort_order INT NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_thali_sections_template ON thali_sections(template_id);
CREATE INDEX IF NOT EXISTS idx_thali_options_section ON thali_options(section_id);

-- snapshot column for customized thali line items (used by checkout later)
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS thali_config JSONB;
