-- Add ApparelMagic connections table
CREATE TABLE IF NOT EXISTS apparelmagic_connections (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  subdomain TEXT NOT NULL,
  token TEXT NOT NULL,
  last_sync_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(workspace_id)
);

-- Enable RLS
ALTER TABLE apparelmagic_connections ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view their workspace ApparelMagic connection"
  ON apparelmagic_connections FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM workspace_members
      WHERE workspace_members.workspace_id = apparelmagic_connections.workspace_id
      AND workspace_members.user_id = auth.uid()
      AND workspace_members.status = 'active'
    )
  );

CREATE POLICY "Workspace owners and admins can manage ApparelMagic connection"
  ON apparelmagic_connections FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM workspace_members
      WHERE workspace_members.workspace_id = apparelmagic_connections.workspace_id
      AND workspace_members.user_id = auth.uid()
      AND workspace_members.status = 'active'
      AND workspace_members.role IN ('owner', 'admin')
    )
  );

-- Indexes
CREATE INDEX idx_apparelmagic_workspace ON apparelmagic_connections(workspace_id);
