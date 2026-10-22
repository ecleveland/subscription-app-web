import { ReactNode } from 'react';
import ThemeToggle from '@/components/ThemeToggle';

/**
 * Frame for the signed-out pages (login, register, password reset). A quiet
 * brand column on wide screens, a single stacked column on phones.
 */
export default function AuthShell({
  title,
  lede,
  children,
}: {
  title: string;
  lede?: string;
  children: ReactNode;
}) {
  return (
    <div className="relative min-h-screen bg-paper lg:grid lg:grid-cols-[5fr_7fr]">
      <div className="absolute right-4 top-4 z-10">
        <ThemeToggle />
      </div>
      <aside className="hidden border-r border-line bg-surface lg:flex lg:flex-col lg:justify-between lg:p-10">
        <p className="font-display text-xl font-medium tracking-tight text-ink">
          Subscription Tracker
        </p>
        <div>
          <p className="font-display text-4xl font-medium leading-tight tracking-tight text-ink">
            Every recurring charge,
            <br />
            <span className="italic text-accent">on one ledger.</span>
          </p>
          <p className="mt-4 max-w-sm text-sm text-muted">
            Subscriptions, bills, budgets and goals for the whole household, with
            the next charge always in view.
          </p>
        </div>
        <p className="eyebrow">Household finance</p>
      </aside>
      <div className="flex min-h-screen items-center justify-center px-4 py-12 lg:min-h-0">
        <div className="w-full max-w-sm">
          <p className="eyebrow mb-3 lg:hidden">Subscription Tracker</p>
          <h1 className="page-title">{title}</h1>
          {lede && <p className="mt-2 text-sm text-muted">{lede}</p>}
          <div className="mt-8">{children}</div>
        </div>
      </div>
    </div>
  );
}
