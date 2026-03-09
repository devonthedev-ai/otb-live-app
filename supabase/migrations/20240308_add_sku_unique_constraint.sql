-- Add unique constraint for SKU upserts
ALTER TABLE products
ADD CONSTRAINT products_workspace_sku_unique 
UNIQUE (workspace_id, sku);
