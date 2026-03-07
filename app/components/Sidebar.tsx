// app/components/Sidebar.tsx
'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/app/context/AuthContext';
import { useWorkspace } from '@/app/context/WorkspaceContext';

const navItems = [
  { name: 'Dashboard', href: '/', icon: '📊' },
  { name: 'Inventory', href: '/dashboard', icon: '📦' },
  { name: 'Integrations', href: '/integrations', icon: '🔌' },
  { name: 'Settings', href: '/settings/billing', icon: '⚙️' },
];

export function Sidebar() {
  const pathname = usePathname();
  const { user, signOut } = useAuth();
  const { currentWorkspace } = useWorkspace();

  return (
    <aside className="w-64 bg-white border-r border-gray-200 min-h-screen flex flex-col">
      {/* Logo */}
      <div className="p-6 border-b border-gray-200">
        <h1 className="text-xl font-bold text-gray-900">OTB Live</h1>
        <p className="text-sm text-gray-500">Inventory Planning</p>
      </div>

      {/* Navigation */}
      <nav className="flex-1 p-4 space-y-1">
        {navItems.map((item) => {
          const isActive = pathname === item.href || pathname?.startsWith(item.href + '/');
          return (
            <Link
              key={item.name}
              href={item.href}
              className={`flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-colors ${
                isActive
                  ? 'bg-indigo-50 text-indigo-700'
                  : 'text-gray-700 hover:bg-gray-50'
              }`}
            >
              <span>{item.icon}</span>
              {item.name}
            </Link>
          );
        })}
      </nav>

      {/* User Section */}
      <div className="p-4 border-t border-gray-200">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-8 h-8 bg-indigo-100 rounded-full flex items-center justify-center text-indigo-700 font-medium">
            {user?.email?.[0].toUpperCase() || 'U'}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-gray-900 truncate">{user?.email}</p>
            <p className="text-xs text-gray-500">{currentWorkspace?.plan || 'Free'} Plan</p>
          </div>
        </div>
        <button
          onClick={signOut}
          className="w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-red-50 rounded-lg"
        >
          Sign Out
        </button>
      </div>
    </aside>
  );
}
