// app/(app)/layout.tsx
import { AuthProvider } from '@/app/context/AuthContext';
import { WorkspaceProvider } from '@/app/context/WorkspaceContext';

export default function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AuthProvider>
      <WorkspaceProvider>
        {children}
      </WorkspaceProvider>
    </AuthProvider>
  );
}
