// app/layout.tsx
import { AuthProvider } from '@/app/context/AuthContext';
import { WorkspaceProvider } from '@/app/context/WorkspaceContext';
import './globals.css';

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <AuthProvider>
          <WorkspaceProvider>
            {children}
          </WorkspaceProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
