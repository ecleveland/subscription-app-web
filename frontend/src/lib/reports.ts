import { apiFetch } from './api';
import { shiftMonth } from './budget';
import type { AccountType } from './types';

// Mirrors backend/src/reports/interfaces/*.ts. All money is integer cents;
// convert to display strings only at the UI boundary.

export interface CashFlowMonth {
  month: string; // "YYYY-MM"
  incomeCents: number;
  expenseCents: number;
  netCents: number; // incomeCents - expenseCents
}

// Zero-filled: every month in the requested range has an entry.
export interface CashFlowReport {
  months: CashFlowMonth[];
}

export interface SpendingCategoryRow {
  categoryId: string;
  categoryName: string;
  groupId: string;
  groupName: string | null; // null when the category's group no longer exists
  actualCents: number;
  // null when the category has no budget row that month. A planned 0 stays 0.
  plannedCents: number | null;
}

export interface SpendingReport {
  month: string; // "YYYY-MM"
  // Expense categories only, sorted by actualCents descending.
  categories: SpendingCategoryRow[];
  // Expense spend with no live expense category.
  uncategorizedCents: number;
  // Always the rows' actualCents plus uncategorizedCents.
  totalCents: number;
}

export interface NetWorthAccount {
  accountId: string;
  name: string;
  type: AccountType;
  // End-of-month balance. Credit and loan balances are negative when owed.
  balanceCents: number;
}

export interface NetWorthMonth {
  month: string; // "YYYY-MM"
  assetsCents: number;
  liabilitiesCents: number; // negative when money is owed
  netWorthCents: number; // assetsCents + liabilitiesCents
  accounts: NetWorthAccount[];
}

export interface NetWorthReport {
  months: NetWorthMonth[];
}

// The backend rejects a cash-flow or net-worth range longer than this
// (inclusive of both ends) with a 400.
export const MAX_REPORT_MONTHS = 36;

export function getCashFlow(from: string, to: string): Promise<CashFlowReport> {
  return apiFetch<CashFlowReport>(`/reports/cash-flow?from=${from}&to=${to}`);
}

export function getSpending(month: string): Promise<SpendingReport> {
  return apiFetch<SpendingReport>(`/reports/spending?month=${month}`);
}

export function getNetWorth(from: string, to: string): Promise<NetWorthReport> {
  return apiFetch<NetWorthReport>(`/reports/net-worth?from=${from}&to=${to}`);
}

// The last 12 months, ending with the current UTC month. UTC matches how the
// backend buckets transactions into months.
export function defaultRange(now: Date = new Date()): {
  from: string;
  to: string;
} {
  const to = now.toISOString().slice(0, 7);
  return { from: shiftMonth(to, -11), to };
}

// Months from `from` to `to`, counting both ends. Zero or negative when from
// is after to.
export function monthSpan(from: string, to: string): number {
  const index = (month: string) => {
    const [y, m] = month.split('-').map(Number);
    return y * 12 + (m - 1);
  };
  return index(to) - index(from) + 1;
}

// "2026-09" to "Sep 2026" for chart axes and tables. Pinned to UTC so the
// label never drifts a month from the underlying key.
export function formatShortMonth(month: string): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${month}-01T00:00:00Z`));
}

// Axis ticks: whole dollars from cents, e.g. 123456 to "$1,235".
export function formatAxisDollars(cents: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(cents / 100);
}
