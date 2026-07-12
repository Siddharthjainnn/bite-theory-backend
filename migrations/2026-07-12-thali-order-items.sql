-- Customized thalis enter orders as product-less line items:
-- product_id NULL + thali_config JSONB snapshot (what the kitchen makes).
ALTER TABLE order_items ALTER COLUMN product_id DROP NOT NULL;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS thali_config JSONB;
