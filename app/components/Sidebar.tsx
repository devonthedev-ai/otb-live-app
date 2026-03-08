// app/components/Sidebar.tsx
'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/app/context/AuthContext';
import { 
  Squares2X2Icon,
  PuzzlePieceIcon, 
  Cog6ToothIcon,
} from '@heroicons/react/24/outline';

export function Sidebar() {
  const pathname = usePathname();
  const { user, signOut } = useAuth();

  const navItems = [
    { name: 'Dashboard', href: '/dashboard', icon: Squares2X2Icon },
    { name: 'Integrations', href: '/integrations', icon: PuzzlePieceIcon },
    { name: 'Settings', href: '/settings/billing', icon: Cog6ToothIcon },
  ];

  return (
    <aside className="w-64 bg-[#F5F5F7] border-r border-gray-200/50 min-h-screen flex flex-col">
      {/* Logo */}
      <div className="p-6">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-xl shadow-lg shadow-indigo-500/20 flex items-center justify-center">
            <span className="text-white font-bold text-sm">O</span>
          </div>
          <div>
            <h1 className="font-semibold text-gray-900 tracking-tight">OTB Live</h1>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3">
        <div className="space-y-0.5">
          {navItems.map((item) => {
            const isActive = pathname === item.href || pathname?.startsWith(item.href + '/');
            const Icon = item.icon;
            return (
              <Link
                key={item.name}
                href={item.href}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 ${
                  isActive
                    ? 'bg-white text-gray-900 shadow-sm ring-1 ring-gray-200/50'
                    : 'text-gray-500 hover:bg-white/60 hover:text-gray-900'
                }`}
              >
                <Icon className={`h-5 w-5 ${isActive ? 'text-indigo-600' : 'text-gray-400'}`} />
                {item.name}
              </Link>
            );
          })}
        </div>
      </nav>

      {/* User */}
      <div className="p-4 m-3 bg-white/80 backdrop-blur-sm rounded-2xl border border-gray-200/50">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-8 h-8 bg-gradient-to-br from-gray-700 to-gray-900 rounded-full flex items-center justify-center">
            <span className="text-white text-xs font-medium">{user?.email?.[0].toUpperCase() || 'U'}</span>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-gray-900 truncate">{user?.email?.split('@')[0]}</p>
            <p className="text-xs text-gray-500 truncate">{user?.email}</p>
          </div>
        </div>
        
        <button
          onClick={signOut}
          className="w-full text-xs font-medium text-gray-500 hover:text-red-600 transition-colors py-2"
        >
          Sign Out
        </button>
      </div>
    </aside>
  );
}
