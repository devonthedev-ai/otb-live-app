-- Add archive columns to inventory_levels for dashboard filtering
ALTER TABLE inventory_levels 
ADD COLUMN IF NOT EXISTS is_archived BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS archived_at TIMESTAMP WITH TIME ZONE;

-- Index for fast filtering
CREATE INDEX IF NOT EXISTS idx_inventory_archived ON inventory_levels(workspace_id, is_archived);
