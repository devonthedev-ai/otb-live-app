-- Add target_season column to apparelmagic_connections
ALTER TABLE apparelmagic_connections 
ADD COLUMN IF NOT EXISTS target_season TEXT DEFAULT 'SS26';

-- Update existing rows to have default value
UPDATE apparelmagic_connections 
SET target_season = 'SS26' 
WHERE target_season IS NULL;
