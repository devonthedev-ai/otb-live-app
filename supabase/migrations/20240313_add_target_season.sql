-- Add target_season column to apparelmagic_connections for per-workspace sync configuration
ALTER TABLE apparelmagic_connections ADD COLUMN IF NOT EXISTS target_season TEXT DEFAULT 'SS26';

-- Add comment explaining the column
COMMENT ON COLUMN apparelmagic_connections.target_season IS 'Target season to sync (e.g., SS26, FW25, Core). Defaults to SS26.';
