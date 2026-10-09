'use client';

import { useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { apiFetch } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { useAccounts } from '@/lib/accounts-context';
import { showErrorToast } from '@/lib/toast';
import {
  getCashFlow,
  getSpending,
  getNetWorth,
  defaultRange,
  monthSpan,
  MAX_REPORT_MONTHS,
  type CashFlowReport,
  type SpendingReport,
  type NetWorthReport,
} from '@/lib/reports';
import type { PaginatedResponse, Subscription } from '@/lib/types';
import CashFlowChart from '@/components/CashFlowChart';
import SpendingReportChart from '@/components/SpendingReportChart';
import NetWorthChart from '@/components/NetWorthChart';
import CategoryBreakdownChart from '@/components/CategoryBreakdownChart';
import TopSubscriptionsList from '@/components/TopSubscriptionsList';
import SpendingByCategoryChart from '@/components/SpendingByCategoryChart';

// UTC-framed like the budget page, to match how the backend buckets
// transactions into months.
const currentMonth = () => new Date().toISOString().slice(0, 7);

interface ReportState<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
}

/**
 * Fetch one section's report. Each section owns its state so a failure in one
 * never blanks the others. `key` identifies the request: a change refetches
 * and drops the old result, and a null key (an invalid input, or signed out)
 * skips the fetch and keeps whatever is on screen.
 */
function useReport<T>(
  key: string | null,
  load: () => Promise<T>,
  fallbackError: string,
): ReportState<T> {
  const [state, setState] = useState<ReportState<T> & { key: string | null }>({
    key: null,
    data: null,
    error: null,
    loading: true,
  });

  useEffect(() => {
    if (key === null) return;
    let cancelled = false;
    setState({ key, data: null, error: null, loading: true });
    load()
      .then((data) => {
        if (!cancelled) setState({ key, data, error: null, loading: false });
      })
      .catch((err) => {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : fallbackError;
        showErrorToast(message);
        setState({ key, data: null, error: message, loading: false });
      });
    return () => {
      cancelled = true;
    };
    // `load` closes over the values that make up `key`, so `key` alone
    // decides when to refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return state;
}

function validateRange(from: string, to: string): string | null {
  if (!from || !to) return 'Choose both months';
  const span = monthSpan(from, to);
  if (span < 1) return 'From must not be after to';
  if (span > MAX_REPORT_MONTHS) {
    return `Range must not exceed ${MAX_REPORT_MONTHS} months`;
  }
  return null;
}

const cardClass =
  'bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-4';
const monthInputClass =
  'border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-1.5 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100';
const linkButtonClass =
  'mt-3 inline-block px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700';

function ReportSection({
  id,
  title,
  controls,
  children,
}: {
  id: string;
  title: string;
  controls?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="mb-10">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <h2
          id={id}
          className="text-lg font-semibold text-gray-900 dark:text-gray-100"
        >
          {title}
        </h2>
        {controls}
      </div>
      {children}
    </section>
  );
}

// Loading, error and empty handling shared by the three report sections.
function ReportBody<T>({
  state,
  loadingText,
  isEmpty,
  empty,
  children,
}: {
  state: ReportState<T>;
  loadingText: string;
  isEmpty: (data: T) => boolean;
  empty: ReactNode;
  children: (data: T) => ReactNode;
}) {
  if (state.error) {
    return <p className="text-sm text-red-600 dark:text-red-400">{state.error}</p>;
  }
  if (state.loading || state.data === null) {
    return <p className="text-gray-500 dark:text-gray-400">{loadingText}</p>;
  }
  if (isEmpty(state.data)) {
    return (
      <div className={`${cardClass} text-center py-8`}>{empty}</div>
    );
  }
  return <div className={cardClass}>{children(state.data)}</div>;
}

export default function ReportsPage() {
  const { isAuthenticated } = useAuth();
  const { accounts } = useAccounts();

  const [initial] = useState(defaultRange);
  const [fromInput, setFromInput] = useState(initial.from);
  const [toInput, setToInput] = useState(initial.to);
  const rangeError = validateRange(fromInput, toInput);
  // The last valid range. An invalid edit leaves the charts on this one.
  const [range, setRange] = useState(initial);
  const [month, setMonth] = useState(currentMonth);

  const updateRange = (from: string, to: string) => {
    setFromInput(from);
    setToInput(to);
    if (validateRange(from, to) === null) setRange({ from, to });
  };

  const rangeKey = isAuthenticated ? `${range.from}..${range.to}` : null;

  const cashFlow = useReport<CashFlowReport>(
    rangeKey,
    () => getCashFlow(range.from, range.to),
    'Failed to load cash flow',
  );
  const netWorth = useReport<NetWorthReport>(
    rangeKey,
    () => getNetWorth(range.from, range.to),
    'Failed to load net worth',
  );
  const spending = useReport<SpendingReport>(
    isAuthenticated && month ? month : null,
    () => getSpending(month),
    'Failed to load spending',
  );
  const subscriptions = useReport<Subscription[]>(
    isAuthenticated ? 'subscriptions' : null,
    () =>
      apiFetch<PaginatedResponse<Subscription>>('/subscriptions?limit=0').then(
        (res) => res.data,
      ),
    'Failed to load subscriptions',
  );

  return (
    <main className="max-w-5xl mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-6">
        Reports
      </h1>

      <section
        aria-labelledby="report-range"
        className={`${cardClass} mb-10`}
      >
        <h2
          id="report-range"
          className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-3"
        >
          Date range
        </h2>
        <div className="flex flex-wrap items-end gap-4">
          <label className="flex flex-col gap-1 text-sm text-gray-700 dark:text-gray-300">
            From
            <input
              type="month"
              value={fromInput}
              onChange={(e) => updateRange(e.target.value, toInput)}
              aria-invalid={rangeError !== null}
              className={monthInputClass}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm text-gray-700 dark:text-gray-300">
            To
            <input
              type="month"
              value={toInput}
              onChange={(e) => updateRange(fromInput, e.target.value)}
              aria-invalid={rangeError !== null}
              className={monthInputClass}
            />
          </label>
        </div>
        {rangeError && (
          <p role="alert" className="mt-2 text-sm text-red-600 dark:text-red-400">
            {rangeError}
          </p>
        )}
        <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
          Cash flow and net worth use this range.
        </p>
      </section>

      <ReportSection id="report-cash-flow" title="Cash flow">
        <ReportBody
          state={cashFlow}
          loadingText="Loading cash flow…"
          isEmpty={(r) =>
            r.months.every((m) => m.incomeCents === 0 && m.expenseCents === 0)
          }
          empty={
            <>
              <p className="text-gray-500 dark:text-gray-400">
                No transactions in this range
              </p>
              <Link href="/transactions" className={linkButtonClass}>
                Go to transactions
              </Link>
            </>
          }
        >
          {(r) => <CashFlowChart months={r.months} />}
        </ReportBody>
      </ReportSection>

      <ReportSection
        id="report-spending"
        title="Spending by category"
        controls={
          <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
            Month
            <input
              type="month"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
              className={monthInputClass}
            />
          </label>
        }
      >
        {month ? (
          <ReportBody
            state={spending}
            loadingText="Loading spending…"
            // Matches SpendingReportChart, which adds the Uncategorized row
            // only when it is positive.
            isEmpty={(r) =>
              r.categories.length === 0 && r.uncategorizedCents <= 0
            }
            empty={
              <p className="text-gray-500 dark:text-gray-400">
                No spending this month
              </p>
            }
          >
            {(r) => <SpendingReportChart report={r} />}
          </ReportBody>
        ) : (
          // A cleared input skips the fetch, so hide the old month's chart.
          <p className="text-sm text-red-600 dark:text-red-400">
            Choose a month
          </p>
        )}
      </ReportSection>

      <ReportSection id="report-net-worth" title="Net worth">
        <ReportBody
          state={netWorth}
          loadingText="Loading net worth…"
          // The backend leaves an account out of months before it existed,
          // so only a range where no month has any account is empty.
          isEmpty={(r) => r.months.every((m) => m.accounts.length === 0)}
          empty={
            // The accounts list holds active accounts only. A household whose
            // accounts are all archived gets the "No accounts yet" prompt.
            accounts.length > 0 ? (
              <p className="text-gray-500 dark:text-gray-400">
                No account history in this range
              </p>
            ) : (
              <>
                <p className="text-gray-500 dark:text-gray-400">No accounts yet</p>
                <Link href="/accounts" className={linkButtonClass}>
                  Add an account
                </Link>
              </>
            )
          }
        >
          {(r) => <NetWorthChart months={r.months} />}
        </ReportBody>
      </ReportSection>

      <ReportSection id="report-subscriptions" title="Subscriptions">
        {subscriptions.error ? (
          <p className="text-sm text-red-600 dark:text-red-400">
            {subscriptions.error}
          </p>
        ) : subscriptions.loading || subscriptions.data === null ? (
          <p className="text-gray-500 dark:text-gray-400">
            Loading subscriptions…
          </p>
        ) : (
          <div className="space-y-6">
            <div>
              <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-2">
                Category breakdown
              </h3>
              <div className={cardClass}>
                <CategoryBreakdownChart subscriptions={subscriptions.data} />
              </div>
            </div>
            <div>
              <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-2">
                Top 5 most expensive
              </h3>
              <TopSubscriptionsList subscriptions={subscriptions.data} />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-2">
                Monthly cost by category
              </h3>
              <div className={cardClass}>
                <SpendingByCategoryChart subscriptions={subscriptions.data} />
              </div>
            </div>
          </div>
        )}
      </ReportSection>
    </main>
  );
}
