// context/WorkspaceContext.tsx
'use client';

import { createContext, useContext, useEffect, useState } from 'react';
import { createClient } from '@/app/lib/supabase/client';
import { Workspace, WorkspaceMember } from '@/app/types/database';
import { useAuth } from './AuthContext';

interface WorkspaceContextType {
  workspaces: Workspace[];
  currentWorkspace: Workspace | null;
  members: WorkspaceMember[];
  isLoading: boolean;
  setCurrentWorkspace: (workspace: Workspace) => void;
  createWorkspace: (name: string) => Promise<{ data?: Workspace; error?: Error }>;
  inviteMember: (email: string, role: string) => Promise<{ error?: Error }>;
  refreshWorkspaces: () => Promise<void>;
}

const WorkspaceContext = createContext<WorkspaceContextType | undefined>(undefined);

export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [currentWorkspace, setCurrentWorkspaceState] = useState<Workspace | null>(null);
  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const { user } = useAuth();
  const supabase = createClient();

  // Load workspaces on auth change
  useEffect(() => {
    if (!user) {
      setWorkspaces([]);
      setCurrentWorkspaceState(null);
      setIsLoading(false);
      return;
    }

    fetchWorkspaces();
  }, [user]);

  // Load members when workspace changes
  useEffect(() => {
    if (!currentWorkspace) return;
    fetchMembers(currentWorkspace.id);
    
    // Persist selection
    localStorage.setItem('currentWorkspaceId', currentWorkspace.id);
  }, [currentWorkspace]);

  const fetchWorkspaces = async () => {
    setIsLoading(true);
    
    console.log('Fetching workspaces for user:', user!.id);
    
    const { data, error } = await supabase
      .from('workspace_members')
      .select(`
        workspaces!inner(*)
      `)
      .eq('user_id', user!.id)
      .eq('status', 'active');

    console.log('Workspace query result:', { data, error, count: data?.length });

    if (error) {
      console.error('Error fetching workspaces:', error);
      setIsLoading(false);
      return;
    }

    const workspaceList = (data as unknown as { workspaces: Workspace }[]).map(d => d.workspaces);
    console.log('Parsed workspaces:', workspaceList);
    setWorkspaces(workspaceList);

    // Restore selected workspace or use first
    const savedId = localStorage.getItem('currentWorkspaceId');
    const selected = workspaceList.find(w => w.id === savedId) || workspaceList[0] || null;
    setCurrentWorkspaceState(selected);
    
    setIsLoading(false);
  };

  const fetchMembers = async (workspaceId: string) => {
    const { data, error } = await supabase
      .from('workspace_members')
      .select(`
        *,
        user:auth.users!inner(email, raw_user_meta_data)
      `)
      .eq('workspace_id', workspaceId);

    if (error) {
      console.error('Error fetching members:', error);
      return;
    }

    setMembers(data as unknown as WorkspaceMember[]);
  };

  const setCurrentWorkspace = (workspace: Workspace) => {
    setCurrentWorkspaceState(workspace);
  };

  const createWorkspace = async (name: string) => {
    // Generate slug from name
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

    // Create workspace
    const { data: workspace, error: workspaceError } = await supabase
      .from('workspaces')
      .insert({ name, slug })
      .select()
      .single();

    if (workspaceError) {
      return { error: workspaceError };
    }

    // Add creator as owner
    const { error: memberError } = await supabase
      .from('workspace_members')
      .insert({
        workspace_id: workspace.id,
        user_id: user!.id,
        role: 'owner',
        status: 'active',
      });

    if (memberError) {
      return { error: memberError };
    }

    // Refresh list
    await fetchWorkspaces();
    
    return { data: workspace };
  };

  const inviteMember = async (email: string, role: string) => {
    if (!currentWorkspace) return { error: new Error('No workspace selected') };

    // Create invitation
    const { error } = await supabase
      .from('invitations')
      .insert({
        workspace_id: currentWorkspace.id,
        email,
        role,
        invited_by: user!.id,
        token: crypto.randomUUID(),
        expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      });

    if (error) {
      return { error };
    }

    // TODO: Send email with invitation link

    return {};
  };

  const refreshWorkspaces = async () => {
    await fetchWorkspaces();
  };

  return (
    <WorkspaceContext.Provider
      value={{
        workspaces,
        currentWorkspace,
        members,
        isLoading,
        setCurrentWorkspace,
        createWorkspace,
        inviteMember,
        refreshWorkspaces,
      }}
    >
      {children}
    </WorkspaceContext.Provider>
  );
}

export function useWorkspace() {
  const context = useContext(WorkspaceContext);
  if (context === undefined) {
    throw new Error('useWorkspace must be used within a WorkspaceProvider');
  }
  return context;
}
