'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/lib/auth-context';
import ThemeToggle from '@/components/ThemeToggle';

export default function Header() {
  const { isAuthenticated, user, isAdmin, logout } = useAuth();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  if (!isAuthenticated) return null;

  const closeMenu = () => setMobileMenuOpen(false);

  return (
    <header className="border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
      <div className="max-w-5xl mx-auto px-4 py-3 flex flex-wrap items-center justify-between">
        <Link href="/" className="text-xl font-bold text-gray-900 dark:text-gray-100">
          Subscriptions
        </Link>
        <button
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          className="md:hidden p-2 text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100"
          aria-label="Toggle navigation menu"
          aria-expanded={mobileMenuOpen}
        >
          {mobileMenuOpen ? (
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          ) : (
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          )}
        </button>
        <nav
          className={`${mobileMenuOpen ? 'flex' : 'hidden'} md:flex w-full md:w-auto flex-col md:flex-row items-stretch md:items-center gap-3 md:gap-4 pt-3 md:pt-0 mt-3 md:mt-0 border-t md:border-t-0 border-gray-200 dark:border-gray-700`}
        >
          <Link
            href="/subscriptions/new"
            onClick={closeMenu}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium text-center"
          >
            + Add
          </Link>
          {isAdmin && (
            <Link
              href="/admin/users"
              onClick={closeMenu}
              className="text-sm text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100 transition-colors py-1 md:py-0"
            >
              Admin
            </Link>
          )}
          <Link
            href="/profile"
            onClick={closeMenu}
            className="text-sm text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100 transition-colors py-1 md:py-0"
          >
            Profile
          </Link>
          <div className="flex items-center gap-3 md:gap-4 py-1 md:py-0">
            <ThemeToggle />
            <button
              onClick={() => { closeMenu(); logout(); }}
              className="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
            >
              Logout
            </button>
          </div>
        </nav>
      </div>
    </header>
  );
}
