// Cadence arithmetic for recurring schedules, used by the materialization
// scheduler (VEG-467) and the upcoming reminder cron (VEG-468). The
// cadence-independent UTC helpers live in ../common/utc-date.util.

import { RecurringCadence } from './schemas/recurring-transaction.schema';

/**
 * Step a date forward by exactly ONE period, preserving time-of-day.
 *
 * `anchorDay` is the schedule's intended day-of-month, carried alongside the
 * date rather than re-derived from it. That distinction is the whole point:
 * `SubscriptionsService.advanceToFutureDate` re-derives the day from the
 * STORED date on every run, so a 31st-of-the-month bill clamps to Feb 28 and
 * then stays on the 28th forever (Jan 31 → Feb 28 → Mar 28 → …). Passing the
 * anchor in lets a clamp be temporary: Jan 31 → Feb 28 → Mar 31. Omit it and
 * the day-of-month of `date` is used, which is correct for any anchor ≤ 28.
 *
 * Ignored for weekly, which has no day-of-month identity to preserve.
 *
 * Single-period by design — the materialization scheduler needs each
 * intermediate occurrence to post a Transaction for, which a jump-to-future
 * loop discards. VEG-469 can re-express `advanceToFutureDate` as a loop over
 * this once subscriptions fold into RecurringTransaction.
 */
export function addCadence(
  date: Date,
  cadence: RecurringCadence,
  anchorDay?: number,
): Date {
  const result = new Date(date);
  if (cadence === RecurringCadence.WEEKLY) {
    result.setUTCDate(result.getUTCDate() + 7);
    return result;
  }

  const anchor = anchorDay ?? date.getUTCDate();
  // Land on the 1st before shifting the month/year: setUTCMonth on a 31st
  // would otherwise overflow into the month after the one intended (Jan 31 +
  // 1 month = Mar 3), which then has to be walked back.
  result.setUTCDate(1);
  if (cadence === RecurringCadence.MONTHLY) {
    result.setUTCMonth(result.getUTCMonth() + 1);
  } else {
    result.setUTCFullYear(result.getUTCFullYear() + 1);
  }

  // Day 0 of the following month is the last day of this one.
  const daysInTargetMonth = new Date(
    Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0),
  ).getUTCDate();
  result.setUTCDate(Math.min(anchor, daysInTargetMonth));
  return result;
}
