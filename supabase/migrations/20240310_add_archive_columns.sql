-- Add archive columns to products
ALTER TABLE products 
ADD COLUMN IF NOT EXISTS is_archived BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS archived_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS archive_reason TEXT,
ADD COLUMN IF NOT EXISTS last_sale_date DATE,
ADD COLUMN IF NOT EXISTS total_sold_24mo INTEGER DEFAULT 0;

-- Index for filtering
CREATE INDEX IF NOT EXISTS idx_products_archived ON products(workspace_id, is_archived);

-- RLS for archived items
DROP POLICY IF EXISTS "Users can view products in their workspace" ON products;

CREATE POLICY "Users can view products in their workspace" 
  ON products FOR SELECT 
  USING (workspace_id IN (
    SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
  ));
