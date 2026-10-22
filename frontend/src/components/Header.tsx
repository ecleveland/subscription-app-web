'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { useHousehold } from '@/lib/household-context';
import ThemeToggle from '@/components/ThemeToggle';
import NotificationBell from '@/components/NotificationBell';

type NavItem = { href: string; label: string; adminOnly?: boolean };
type NavGroup = { title: string; items: NavItem[] };

const NAV_GROUPS: NavGroup[] = [
  {
    title: 'Overview',
    items: [{ href: '/', label: 'Dashboard' }],
  },
  {
    title: 'Money',
    items: [
      { href: '/accounts', label: 'Accounts' },
      { href: '/transactions', label: 'Transactions' },
      { href: '/recurring', label: 'Bills' },
      { href: '/budget', label: 'Budget' },
      { href: '/goals', label: 'Goals' },
    ],
  },
  {
    title: 'Insight',
    items: [
      { href: '/reports', label: 'Reports' },
      { href: '/calendar', label: 'Calendar' },
    ],
  },
  {
    title: 'Manage',
    items: [
      { href: '/categories', label: 'Categories' },
      { href: '/household', label: 'Household' },
      { href: '/profile', label: 'Profile' },
      { href: '/admin/users', label: 'Admin', adminOnly: true },
    ],
  },
];

function isActive(pathname: string | null, href: string): boolean {
  if (!pathname) return false;
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(`${href}/`);
}

export default function Header() {
  const { isAuthenticated, isAdmin, logout } = useAuth();
  const { household } = useHousehold();
  const pathname = usePathname();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  if (!isAuthenticated) return null;

  const closeMenu = () => setMobileMenuOpen(false);

  return (
    <header className="sticky top-0 z-30 shrink-0 border-b border-line bg-surface md:sticky md:h-screen md:w-60 md:border-b-0 md:border-r">
      <div className="flex h-14 items-center justify-between px-4 md:h-auto md:flex-col md:items-stretch md:px-0">
        <div className="flex min-w-0 flex-col md:border-b md:border-line md:px-5 md:py-5">
          <Link
            href="/"
            onClick={closeMenu}
            className="font-display text-xl font-medium tracking-tight text-ink"
          >
            Subscriptions
          </Link>
          {household && (
            <Link
              href="/household"
              onClick={closeMenu}
              className="truncate text-xs text-muted transition-colors hover:text-ink"
            >
              {household.name}
            </Link>
          )}
        </div>
        <button
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          className="-mr-2 p-2 text-ink-2 hover:text-ink md:hidden"
          aria-label="Toggle navigation menu"
          aria-expanded={mobileMenuOpen}
        >
          {mobileMenuOpen ? (
            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          ) : (
            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 7h16M4 12h16M4 17h16" />
            </svg>
          )}
        </button>
      </div>

      <div
        className={`${mobileMenuOpen ? 'flex' : 'hidden'} max-h-[calc(100vh-3.5rem)] flex-col overflow-y-auto border-t border-line md:flex md:h-[calc(100vh-4.75rem)] md:max-h-none md:border-t-0`}
      >
        <div className="px-4 pt-4 md:px-5">
          <Link href="/subscriptions/new" onClick={closeMenu} className="btn-primary w-full">
            + Add
          </Link>
        </div>

        <nav className="flex-1 space-y-5 px-3 py-4 md:px-3">
          {NAV_GROUPS.map((group) => {
            const items = group.items.filter((item) => !item.adminOnly || isAdmin);
            return (
              <div key={group.title}>
                <p className="eyebrow mb-1.5 px-2.5">{group.title}</p>
                <ul className="space-y-0.5">
                  {items.map((item) => (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        onClick={closeMenu}
                        aria-current={isActive(pathname, item.href) ? 'page' : undefined}
                        className={`nav-link ${isActive(pathname, item.href) ? 'nav-link-active' : ''}`}
                      >
                        {item.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </nav>

        <div className="flex items-center justify-between gap-2 border-t border-line px-4 py-3 md:px-5">
          <div className="flex items-center gap-1">
            <NotificationBell />
            <ThemeToggle />
          </div>
          <button
            onClick={() => { closeMenu(); logout(); }}
            className="text-sm text-muted transition-colors hover:text-ink"
          >
            Logout
          </button>
        </div>
      </div>
    </header>
  );
}
