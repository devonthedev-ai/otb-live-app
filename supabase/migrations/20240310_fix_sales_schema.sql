-- Fix sales table to support ApparelMagic invoice sync
-- Add missing columns for line-item sales data

-- First, add columns if they don't exist
ALTER TABLE sales 
ADD COLUMN IF NOT EXISTS external_id TEXT,
ADD COLUMN IF NOT EXISTS invoice_id TEXT,
ADD COLUMN IF NOT EXISTS sku TEXT,
ADD COLUMN IF NOT EXISTS style TEXT,
ADD COLUMN IF NOT EXISTS color TEXT,
ADD COLUMN IF NOT EXISTS size TEXT,
ADD COLUMN IF NOT EXISTS unit_price DECIMAL(10,2),
ADD COLUMN IF NOT EXISTS amount DECIMAL(10,2),
ADD COLUMN IF NOT EXISTS customer_id TEXT,
ADD COLUMN IF NOT EXISTS channel TEXT DEFAULT 'wholesale',
ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'apparelmagic';

-- Make product_id nullable (since we link by SKU, not product UUID)
ALTER TABLE sales ALTER COLUMN product_id DROP NOT NULL;

-- Rename units to qty for consistency (or add qty as alias)
-- Note: keeping 'units' for now, sync code will map qty -> units

-- Add unique constraint for deduplication
ALTER TABLE sales 
DROP CONSTRAINT IF EXISTS sales_workspace_external_unique;

ALTER TABLE sales 
ADD CONSTRAINT sales_workspace_external_unique 
UNIQUE (workspace_id, external_id);

-- Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_sales_external_id ON sales(external_id);
CREATE INDEX IF NOT EXISTS idx_sales_invoice_id ON sales(invoice_id);
CREATE INDEX IF NOT EXISTS idx_sales_sku ON sales(sku);
