-- Create inventory_levels table for ApparelMagic sync
CREATE TABLE IF NOT EXISTS inventory_levels (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  external_id TEXT,
  sku TEXT NOT NULL,
  style TEXT NOT NULL,
  color TEXT,
  size TEXT,
  qty_on_hand DECIMAL(10,2) DEFAULT 0,
  qty_available DECIMAL(10,2) DEFAULT 0,
  qty_allocated DECIMAL(10,2) DEFAULT 0,
  qty_reserved DECIMAL(10,2) DEFAULT 0,
  qty_open_po DECIMAL(10,2) DEFAULT 0,
  upc TEXT,
  cost DECIMAL(10,2),
  price DECIMAL(10,2),
  weight DECIMAL(10,2),
  source TEXT DEFAULT 'apparelmagic',
  last_synced_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(workspace_id, sku)
);

-- Enable RLS
ALTER TABLE inventory_levels ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view their workspace inventory"
  ON inventory_levels FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM workspace_members
      WHERE workspace_members.workspace_id = inventory_levels.workspace_id
      AND workspace_members.user_id = auth.uid()
      AND workspace_members.status = 'active'
    )
  );

CREATE POLICY "Workspace owners and admins can manage inventory"
  ON inventory_levels FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM workspace_members
      WHERE workspace_members.workspace_id = inventory_levels.workspace_id
      AND workspace_members.user_id = auth.uid()
      AND workspace_members.status = 'active'
      AND workspace_members.role IN ('owner', 'admin')
    )
  );

-- Indexes
CREATE INDEX idx_inventory_workspace ON inventory_levels(workspace_id, sku);
CREATE INDEX idx_inventory_style ON inventory_levels(workspace_id, style);

-- Add columns to apparelmagic_connections for sync tracking
ALTER TABLE apparelmagic_connections 
ADD COLUMN IF NOT EXISTS last_inventory_sync TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS last_sales_sync TIMESTAMP WITH TIME ZONE;
