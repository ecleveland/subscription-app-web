import type { Subscription } from './types';

export interface CalendarDay {
  date: number;
  month: number;
  year: number;
  isCurrentMonth: boolean;
}

/**
 * Returns all dates in the given month when a subscription bills,
 * by projecting forward/backward from its nextBillingDate anchor.
 */
export function getBillingDatesInMonth(
  subscription: Subscription,
  year: number,
  month: number,
): Date[] {
  const anchor = new Date(subscription.nextBillingDate);
  if (isNaN(anchor.getTime())) return [];

  const results: Date[] = [];
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  if (subscription.billingCycle === 'weekly') {
    // Find the first occurrence of the same weekday in or before this month
    const anchorDay = anchor.getUTCDay();
    const firstOfMonth = new Date(year, month, 1);
    const firstDayOfWeek = firstOfMonth.getDay();
    let diff = anchorDay - firstDayOfWeek;
    if (diff < 0) diff += 7;
    let day = 1 + diff;

    while (day <= daysInMonth) {
      results.push(new Date(year, month, day));
      day += 7;
    }
  } else if (subscription.billingCycle === 'monthly') {
    const anchorDay = anchor.getUTCDate();
    // Clamp to last day of month if needed (e.g., 31st in a 30-day month)
    const billingDay = Math.min(anchorDay, daysInMonth);
    results.push(new Date(year, month, billingDay));
  } else if (subscription.billingCycle === 'yearly') {
    const anchorMonth = anchor.getUTCMonth();
    if (anchorMonth === month) {
      const anchorDay = anchor.getUTCDate();
      const billingDay = Math.min(anchorDay, daysInMonth);
      results.push(new Date(year, month, billingDay));
    }
  }

  return results;
}

/**
 * Returns an array of CalendarDay cells for a 6-row (42-cell) month grid,
 * including leading days from the previous month and trailing days from the next.
 */
export function getCalendarDays(year: number, month: number): CalendarDay[] {
  const firstDay = new Date(year, month, 1).getDay(); // 0=Sun
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const daysInPrevMonth = new Date(year, month, 0).getDate();

  const days: CalendarDay[] = [];

  // Leading days from previous month
  const prevMonth = month === 0 ? 11 : month - 1;
  const prevYear = month === 0 ? year - 1 : year;
  for (let i = firstDay - 1; i >= 0; i--) {
    days.push({
      date: daysInPrevMonth - i,
      month: prevMonth,
      year: prevYear,
      isCurrentMonth: false,
    });
  }

  // Current month days
  for (let d = 1; d <= daysInMonth; d++) {
    days.push({ date: d, month, year, isCurrentMonth: true });
  }

  // Trailing days from next month
  const nextMonth = month === 11 ? 0 : month + 1;
  const nextYear = month === 11 ? year + 1 : year;
  let trailing = 1;
  while (days.length < 42) {
    days.push({
      date: trailing++,
      month: nextMonth,
      year: nextYear,
      isCurrentMonth: false,
    });
  }

  return days;
}
