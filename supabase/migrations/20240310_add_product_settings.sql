-- Add product settings table for lead times, MOQs, and vendor info
CREATE TABLE IF NOT EXISTS product_settings (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  sku TEXT NOT NULL,
  style TEXT NOT NULL,
  color TEXT,
  size TEXT,
  
  -- Reorder settings
  lead_time_days INTEGER DEFAULT 60,
  moq INTEGER DEFAULT 1, -- Minimum order quantity
  moq_amount DECIMAL(10,2), -- Minimum order $ amount (optional)
  
  -- Vendor info
  vendor_id TEXT,
  vendor_name TEXT,
  
  -- Planning parameters
  safety_stock_days INTEGER DEFAULT 14, -- Days of safety stock to maintain
  reorder_point INTEGER, -- Auto-calculated or manual override
  
  -- Overrides
  is_manual_lead_time BOOLEAN DEFAULT false,
  is_manual_moq BOOLEAN DEFAULT false,
  
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  UNIQUE(workspace_id, sku)
);

-- Index for lookups
CREATE INDEX IF NOT EXISTS idx_product_settings_workspace_sku ON product_settings(workspace_id, sku);
CREATE INDEX IF NOT EXISTS idx_product_settings_vendor ON product_settings(workspace_id, vendor_name);

-- Enable RLS
ALTER TABLE product_settings ENABLE ROW LEVEL SECURITY;

-- RLS policies
CREATE POLICY "Users can view product settings in their workspace" 
  ON product_settings FOR SELECT 
  USING (workspace_id IN (
    SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
  ));

CREATE POLICY "Owners and admins can manage product settings" 
  ON product_settings FOR ALL 
  USING (workspace_id IN (
    SELECT workspace_id FROM workspace_members 
    WHERE user_id = auth.uid() AND role IN ('owner', 'admin', 'buyer')
  ));
