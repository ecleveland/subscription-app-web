// Cadence arithmetic for recurring schedules, used by the materialization
// scheduler (VEG-467) and the upcoming reminder cron (VEG-468). The
// cadence-independent UTC helpers live in ../common/utc-date.util.

import { RecurringCadence } from './schemas/recurring-transaction.schema';
import { utcDay } from '../common/utc-date.util';

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

/** The fields `settleTrackedSubscriptionDate` reads from a schedule. */
export interface TrackedSubscriptionState {
  isSubscription?: boolean;
  accountId?: unknown;
  isActive: boolean;
  nextDate: Date;
  cadence: RecurringCadence;
  cadenceAnchorDay?: number;
}

/**
 * The nextDate a subscription may be saved with. Ledger history for a
 * subscription starts when it can post. It is never backfilled through the
 * API, whatever path got it there: create with a past date, first attach,
 * reactivation, or a date edited into the past, through /api/subscriptions or
 * /api/recurring. So a subscription that can post (has an account and is
 * active) with a date before today rolls forward on its cadence to the first
 * occurrence on or after today. Anything else returns its date unchanged.
 * Ordinary bills keep their replay behavior, and the scheduler still replays
 * a run it missed, so a renewal is never lost to a restart.
 *
 * A migrated subscription has no stored anchor, so the starting date's day
 * stands in for it, which keeps Jan 31 rolling to Feb 28 and then Mar 31.
 */
export function settleTrackedSubscriptionDate(
  state: TrackedSubscriptionState,
  now: Date,
): Date {
  if (
    !state.isSubscription ||
    !state.accountId ||
    !state.isActive ||
    utcDay(state.nextDate) >= utcDay(now)
  ) {
    return state.nextDate;
  }
  const anchor = state.cadenceAnchorDay ?? state.nextDate.getUTCDate();
  let next = state.nextDate;
  while (utcDay(next) < utcDay(now)) {
    next = addCadence(next, state.cadence, anchor);
  }
  return next;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Whole UTC calendar days from `now`'s day to `nextDate`'s day. Time-of-day on
 * either side is ignored, so a bill dated late tonight is still 0 days away.
 * Negative for a date already past.
 */
export function daysUntil(nextDate: Date, now: Date): number {
  return (utcDay(nextDate) - utcDay(now)) / DAY_MS;
}

/**
 * Whether today falls in a schedule's reminder window: from
 * `reminderDaysBefore` days out up to, but not including, the due day. The
 * due day itself is excluded because the midnight materializer has already
 * posted that occurrence, so a "due soon" nudge would arrive after the fact.
 */
export function isInReminderWindow(
  nextDate: Date,
  reminderDaysBefore: number,
  now: Date,
): boolean {
  if (reminderDaysBefore <= 0) return false;
  const days = daysUntil(nextDate, now);
  return days > 0 && days <= reminderDaysBefore;
}
