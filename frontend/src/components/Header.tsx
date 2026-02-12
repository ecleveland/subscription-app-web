'use client';

import Link from 'next/link';
import { useAuth } from '@/lib/auth-context';

export default function Header() {
  const { isAuthenticated, logout } = useAuth();

  if (!isAuthenticated) return null;

  return (
    <header className="border-b border-gray-200 bg-white">
      <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between">
        <Link href="/" className="text-xl font-bold text-gray-900">
          Subscriptions
        </Link>
        <nav className="flex items-center gap-4">
          <Link
            href="/subscriptions/new"
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium"
          >
            + Add
          </Link>
          <button
            onClick={logout}
            className="text-sm text-gray-500 hover:text-gray-700 transition-colors"
          >
            Logout
          </button>
        </nav>
      </div>
    </header>
  );
}
