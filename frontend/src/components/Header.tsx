'use client';

import Link from 'next/link';
import { useAuth } from '@/lib/auth-context';
import ThemeToggle from '@/components/ThemeToggle';

export default function Header() {
  const { isAuthenticated, user, isAdmin, logout } = useAuth();

  if (!isAuthenticated) return null;

  return (
    <header className="border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
      <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between">
        <Link href="/" className="text-xl font-bold text-gray-900 dark:text-gray-100">
          Subscriptions
        </Link>
        <nav className="flex items-center gap-4">
          <Link
            href="/subscriptions/new"
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium"
          >
            + Add
          </Link>
          {isAdmin && (
            <Link
              href="/admin/users"
              className="text-sm text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100 transition-colors"
            >
              Admin
            </Link>
          )}
          <Link
            href="/profile"
            className="text-sm text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100 transition-colors"
          >
            {user?.displayName || user?.username || 'Profile'}
          </Link>
          <ThemeToggle />
          <button
            onClick={logout}
            className="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
          >
            Logout
          </button>
        </nav>
      </div>
    </header>
  );
}
