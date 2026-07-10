export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(amount);
}

/** Format integer minor units (cents) as a currency string, e.g. -1234 -> -$12.34. */
export function formatCents(cents: number): string {
  return formatCurrency(cents / 100);
}

/**
 * Convert a user-entered dollar amount to integer cents, or null if it isn't a
 * valid non-negative number. Rounds to the nearest cent to avoid float drift.
 */
export function dollarsToCents(value: string): number | null {
  const trimmed = value.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) {
    return null;
  }
  return Math.round(parseFloat(trimmed) * 100);
}

/** Sort by sortOrder ascending, breaking ties by name — the display order for
 *  category groups and categories (shared by the categories & budget pages). */
export const bySortOrder = <T extends { sortOrder: number; name: string }>(
  a: T,
  b: T,
): number => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name);

export function formatDate(date: Date | string): string {
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(new Date(date));
}

export function getMonthlyCost(
  cost: number,
  billingCycle: 'weekly' | 'monthly' | 'yearly',
): number {
  if (billingCycle === 'weekly') return cost * 4.33;
  return billingCycle === 'yearly' ? cost / 12 : cost;
}

export function getYearlyCost(
  cost: number,
  billingCycle: 'weekly' | 'monthly' | 'yearly',
): number {
  if (billingCycle === 'weekly') return cost * 52.14;
  return billingCycle === 'monthly' ? cost * 12 : cost;
}

export function getDailyCost(
  cost: number,
  billingCycle: 'weekly' | 'monthly' | 'yearly',
): number {
  if (billingCycle === 'weekly') return cost / 7;
  return billingCycle === 'yearly' ? cost / 365 : cost / (365 / 12);
}

export function getWeeklyCost(
  cost: number,
  billingCycle: 'weekly' | 'monthly' | 'yearly',
): number {
  if (billingCycle === 'weekly') return cost;
  return billingCycle === 'yearly' ? cost / (365 / 7) : cost / (365 / 12 / 7);
}

export function getPersonalShare(
  cost: number,
  sharedWith?: number | null,
): number {
  if (sharedWith != null && sharedWith >= 2) return cost / sharedWith;
  return cost;
}

const MS_PER_DAY = 1000 * 60 * 60 * 24;

/**
 * Midnight (00:00:00.000) UTC of the day containing the given date. Stored
 * date-only values (e.g. "2025-06-15") parse as UTC, so flooring to a UTC day
 * keeps date math in one consistent frame regardless of the viewer's timezone.
 */
export function startOfUtcDay(date: Date | string): Date {
  const d = new Date(date);
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
  );
}

/**
 * Whole-day difference between now and the target, both floored to a UTC day,
 * so "today" and "expiring soon (≤N)" stay day-granular and don't flip based on
 * the time of day or proximity to midnight.
 */
export function daysUntil(date: Date | string): number {
  const start = startOfUtcDay(new Date());
  const target = startOfUtcDay(date);
  return Math.round((target.getTime() - start.getTime()) / MS_PER_DAY);
}
