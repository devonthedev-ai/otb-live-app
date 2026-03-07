// app/components/Sidebar.tsx
'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/app/context/AuthContext';

export function Sidebar() {
  const pathname = usePathname();
  const { user, signOut } = useAuth();

  const navItems = [
    { name: 'Dashboard', href: '/dashboard' },
    { name: 'Integrations', href: '/integrations' },
    { name: 'Settings', href: '/settings/billing' },
  ];

  return (
    <aside className="w-64 bg-gray-900 text-white min-h-screen flex flex-col">
      <div className="p-6 border-b border-gray-800">
        <h1 className="font-bold text-xl">OTB Live</h1>
        <p className="text-xs text-gray-400">Inventory Planning</p>
      </div>

      <nav className="flex-1 p-4">
        {navItems.map((item) => {
          const isActive = pathname === item.href || pathname?.startsWith(item.href + '/');
          return (
            <Link
              key={item.name}
              href={item.href}
              className={`block px-4 py-3 rounded-lg text-sm font-medium mb-1 ${
                isActive
                  ? 'bg-indigo-600 text-white'
                  : 'text-gray-300 hover:bg-gray-800'
              }`}
            >
              {item.name}
            </Link>
          );
        })}
      </nav>

      <div className="p-4 border-t border-gray-800">
        <p className="text-sm text-gray-300 mb-3 truncate">{user?.email}</p>
        <button
          onClick={signOut}
          className="text-sm text-red-400 hover:text-red-300"
        >
          Sign Out
        </button>
      </div>
    </aside>
  );
}
