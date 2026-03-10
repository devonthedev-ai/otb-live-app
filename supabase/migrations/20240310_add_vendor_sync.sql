-- Add vendor sync tracking
ALTER TABLE apparelmagic_connections 
ADD COLUMN IF NOT EXISTS last_vendor_sync TIMESTAMP WITH TIME ZONE;
