-- Add missing columns to products table for ApparelMagic integration
ALTER TABLE products
ADD COLUMN IF NOT EXISTS sku text,
ADD COLUMN IF NOT EXISTS name text,
ADD COLUMN IF NOT EXISTS external_id text,
ADD COLUMN IF NOT EXISTS vendor_id text,
ADD COLUMN IF NOT EXISTS source text DEFAULT 'manual';

-- Add index on sku for faster lookups
CREATE INDEX IF NOT EXISTS idx_products_sku ON products(workspace_id, sku);
