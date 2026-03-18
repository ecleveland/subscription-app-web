import { getBillingDatesInMonth, getCalendarDays } from '../calendar';
import type { Subscription } from '../types';

function makeSub(overrides: Partial<Subscription> = {}): Subscription {
  return {
    _id: '1',
    userId: 'u1',
    name: 'Test',
    cost: 10,
    billingCycle: 'monthly',
    nextBillingDate: '2026-03-15',
    category: 'Streaming',
    isActive: true,
    reminderDaysBefore: 3,
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
    ...overrides,
  };
}

describe('getBillingDatesInMonth', () => {
  it('should return the correct day for a monthly subscription', () => {
    const sub = makeSub({ nextBillingDate: '2026-03-15', billingCycle: 'monthly' });
    const dates = getBillingDatesInMonth(sub, 2026, 2); // March 2026
    expect(dates).toHaveLength(1);
    expect(dates[0].getDate()).toBe(15);
    expect(dates[0].getMonth()).toBe(2);
  });

  it('should return the correct day for a monthly subscription in a different month', () => {
    const sub = makeSub({ nextBillingDate: '2026-03-15', billingCycle: 'monthly' });
    const dates = getBillingDatesInMonth(sub, 2026, 5); // June 2026
    expect(dates).toHaveLength(1);
    expect(dates[0].getDate()).toBe(15);
    expect(dates[0].getMonth()).toBe(5);
  });

  it('should clamp end-of-month for monthly subscriptions (31st in a 30-day month)', () => {
    const sub = makeSub({ nextBillingDate: '2026-01-31', billingCycle: 'monthly' });
    // April has 30 days
    const dates = getBillingDatesInMonth(sub, 2026, 3); // April 2026
    expect(dates).toHaveLength(1);
    expect(dates[0].getDate()).toBe(30);
  });

  it('should clamp end-of-month for monthly subscriptions (31st in February)', () => {
    const sub = makeSub({ nextBillingDate: '2026-01-31', billingCycle: 'monthly' });
    const dates = getBillingDatesInMonth(sub, 2026, 1); // February 2026 (28 days)
    expect(dates).toHaveLength(1);
    expect(dates[0].getDate()).toBe(28);
  });

  it('should return multiple dates for a weekly subscription', () => {
    // 2026-03-02 is a Monday
    const sub = makeSub({ nextBillingDate: '2026-03-02', billingCycle: 'weekly' });
    const dates = getBillingDatesInMonth(sub, 2026, 2); // March 2026
    // Mondays in March 2026: 2, 9, 16, 23, 30
    expect(dates).toHaveLength(5);
    expect(dates.map((d) => d.getDate())).toEqual([2, 9, 16, 23, 30]);
  });

  it('should return 4 weekly billing dates when the month has only 4 of that weekday', () => {
    // 2026-03-03 is a Tuesday
    const sub = makeSub({ nextBillingDate: '2026-03-03', billingCycle: 'weekly' });
    const dates = getBillingDatesInMonth(sub, 2026, 2); // March 2026
    // Tuesdays in March 2026: 3, 10, 17, 24, 31
    expect(dates).toHaveLength(5);
    expect(dates.map((d) => d.getDate())).toEqual([3, 10, 17, 24, 31]);
  });

  it('should return billing date only in the correct month for yearly subscriptions', () => {
    const sub = makeSub({ nextBillingDate: '2026-06-15', billingCycle: 'yearly' });

    // Should bill in June
    const juneDate = getBillingDatesInMonth(sub, 2026, 5);
    expect(juneDate).toHaveLength(1);
    expect(juneDate[0].getDate()).toBe(15);

    // Should NOT bill in March
    const marchDates = getBillingDatesInMonth(sub, 2026, 2);
    expect(marchDates).toHaveLength(0);
  });

  it('should clamp yearly subscription date for short months', () => {
    const sub = makeSub({ nextBillingDate: '2026-02-28', billingCycle: 'yearly' });
    // In a leap year February has 29 days, but 2026 is not a leap year
    const dates = getBillingDatesInMonth(sub, 2026, 1);
    expect(dates).toHaveLength(1);
    expect(dates[0].getDate()).toBe(28);
  });

  it('should return empty array for invalid nextBillingDate', () => {
    const sub = makeSub({ nextBillingDate: 'invalid-date' });
    const dates = getBillingDatesInMonth(sub, 2026, 2);
    expect(dates).toHaveLength(0);
  });
});

describe('getCalendarDays', () => {
  it('should return exactly 42 days (6 rows of 7)', () => {
    const days = getCalendarDays(2026, 2); // March 2026
    expect(days).toHaveLength(42);
  });

  it('should start with Sunday of the first week', () => {
    // March 2026 starts on a Sunday
    const days = getCalendarDays(2026, 2);
    expect(days[0].date).toBe(1);
    expect(days[0].isCurrentMonth).toBe(true);
  });

  it('should include leading days from previous month when month does not start on Sunday', () => {
    // April 2026 starts on a Wednesday (day index 3)
    const days = getCalendarDays(2026, 3);
    // First 3 days should be from March
    expect(days[0].isCurrentMonth).toBe(false);
    expect(days[0].date).toBe(29); // March 29
    expect(days[1].date).toBe(30); // March 30
    expect(days[2].date).toBe(31); // March 31
    expect(days[3].date).toBe(1);  // April 1
    expect(days[3].isCurrentMonth).toBe(true);
  });

  it('should include trailing days from next month', () => {
    const days = getCalendarDays(2026, 2); // March 2026
    // March has 31 days, starts on Sunday → last March day is at index 30
    // Index 31 onwards should be April
    expect(days[31].date).toBe(1);
    expect(days[31].isCurrentMonth).toBe(false);
  });

  it('should mark current month days correctly', () => {
    const days = getCalendarDays(2026, 2);
    const currentMonthDays = days.filter((d) => d.isCurrentMonth);
    expect(currentMonthDays).toHaveLength(31); // March has 31 days
  });

  it('should handle January correctly (previous month is December of previous year)', () => {
    const days = getCalendarDays(2026, 0); // January 2026
    // January 2026 starts on a Thursday (day index 4)
    const leading = days.filter((d) => !d.isCurrentMonth && d.month === 11);
    expect(leading.length).toBeGreaterThan(0);
    expect(leading[0].year).toBe(2025);
  });

  it('should handle December correctly (next month is January of next year)', () => {
    const days = getCalendarDays(2026, 11); // December 2026
    const trailing = days.filter((d) => !d.isCurrentMonth && d.month === 0);
    expect(trailing.length).toBeGreaterThan(0);
    expect(trailing[0].year).toBe(2027);
  });
});
