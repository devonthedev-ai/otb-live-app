-- Add seasonal analysis fields to recommendations table
-- Run this in Supabase SQL Editor

-- Add seasonal classification fields
ALTER TABLE recommendations 
ADD COLUMN IF NOT EXISTS seasonal_classification TEXT 
CHECK (seasonal_classification IN ('core', 'seasonal', 'holiday', 'declining', 'emerging'));

ALTER TABLE recommendations 
ADD COLUMN IF NOT EXISTS seasonal_confidence INTEGER;

ALTER TABLE recommendations 
ADD COLUMN IF NOT EXISTS peak_months INTEGER[];

ALTER TABLE recommendations 
ADD COLUMN IF NOT EXISTS seasonal_multiplier DECIMAL(4,2) DEFAULT 1.0;

-- Create seasonal_patterns table for storing detailed analysis
CREATE TABLE IF NOT EXISTS seasonal_patterns (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE NOT NULL,
  product_id UUID REFERENCES products(id) ON DELETE CASCADE NOT NULL,
  
  -- Analysis results
  is_seasonal BOOLEAN DEFAULT false,
  peak_months INTEGER[],
  trough_months INTEGER[],
  seasonality_score DECIMAL(4,2),
  classification TEXT CHECK (classification IN ('core', 'seasonal', 'holiday')),
  confidence INTEGER,
  
  -- YoY trend
  yoy_growth_rate DECIMAL(6,4),
  yoy_is_growing BOOLEAN,
  yoy_confidence INTEGER,
  
  -- Metadata
  analysis_date TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  data_points INTEGER,
  
  -- User override
  user_override TEXT CHECK (user_override IN ('core', 'seasonal', null)),
  
  -- Unique constraint
  UNIQUE(workspace_id, product_id)
);

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_seasonal_patterns_workspace 
ON seasonal_patterns(workspace_id, product_id);

-- RLS for seasonal_patterns
ALTER TABLE seasonal_patterns ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Workspace data isolation" ON seasonal_patterns
FOR ALL USING (workspace_id IN (
  SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
));
