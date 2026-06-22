// Budget months are identified by a "YYYY-MM" string (see Budget schema). These
// helpers keep that convention — and the month → date-range math the
// budget-vs-actual reader depends on — in one tested place.

// Same shape the Budget schema's `match` validator enforces; kept here so the
// controller/service can reject a malformed :month param before touching Mongo.
export const MONTH_REGEX = /^\d{4}-(0[1-9]|1[0-2])$/;

export function isValidMonth(month: string): boolean {
  return MONTH_REGEX.test(month);
}

/**
 * Convert a "YYYY-MM" month to a half-open UTC date range `[start, end)` for
 * matching transactions. The convention is **UTC and exclusive on the upper
 * bound**: `start` is the first instant of the month, `end` is the first instant
 * of the next month. Using `date >= start && date < end` is timezone-stable and
 * sidesteps per-month day counts and DST entirely (UTC has no DST). `Date.UTC`
 * handles the December → next-January rollover automatically.
 */
export function monthToUtcRange(month: string): { start: Date; end: Date } {
  if (!isValidMonth(month)) {
    throw new Error(`Invalid budget month "${month}" (expected YYYY-MM)`);
  }
  const [year, monthNumber] = month.split('-').map(Number);
  // monthNumber is 1-based; Date.UTC month arg is 0-based.
  const start = new Date(Date.UTC(year, monthNumber - 1, 1));
  const end = new Date(Date.UTC(year, monthNumber, 1));
  return { start, end };
}
