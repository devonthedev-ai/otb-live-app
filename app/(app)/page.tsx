// app/(app)/page.tsx - Protected app with auth check
'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/app/context/AuthContext';
import { useWorkspace } from '@/app/context/WorkspaceContext';
import Dashboard from './dashboard';

export default function AppPage() {
  const { user, isLoading } = useAuth();
  const { currentWorkspace, isLoading: workspaceLoading } = useWorkspace();
  const router = useRouter();

  useEffect(() => {
    if (!isLoading && !user) {
      router.push('/login');
    }
  }, [user, isLoading, router]);

  if (isLoading || workspaceLoading) {
    return (
      <div className="min-h-screen bg-[#F5F5F7] flex items-center justify-center">
        <div className="text-gray-500">Loading...</div>
      </div>
    );
  }

  if (!user) {
    return null; // Will redirect
  }

  if (!currentWorkspace) {
    return (
      <div className="min-h-screen bg-[#F5F5F7] flex items-center justify-center">
        <div className="text-center">
          <p className="text-gray-500">No workspace found.</p>
          <button
            onClick={() => router.push('/signup')}
            className="mt-4 px-4 py-2 bg-blue-600 text-white rounded-lg"
          >
            Create Workspace
          </button>
        </div>
      </div>
    );
  }

  return <Dashboard />;
}
