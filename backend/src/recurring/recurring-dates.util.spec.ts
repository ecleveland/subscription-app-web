import {
  addCadence,
  daysUntil,
  isInReminderWindow,
  settleTrackedSubscriptionDate,
} from './recurring-dates.util';
import { RecurringCadence } from './schemas/recurring-transaction.schema';

describe('addCadence', () => {
  const iso = (d: Date) => d.toISOString().slice(0, 10);

  it('steps forward one week', () => {
    expect(
      iso(
        addCadence(new Date('2026-08-01T00:00:00Z'), RecurringCadence.WEEKLY),
      ),
    ).toBe('2026-08-08');
  });

  it('steps a week across a month and year boundary', () => {
    expect(
      iso(
        addCadence(new Date('2026-12-28T00:00:00Z'), RecurringCadence.WEEKLY),
      ),
    ).toBe('2027-01-04');
  });

  it('steps forward one month', () => {
    expect(
      iso(
        addCadence(new Date('2026-08-01T00:00:00Z'), RecurringCadence.MONTHLY),
      ),
    ).toBe('2026-09-01');
  });

  it('steps a month across the year boundary', () => {
    expect(
      iso(
        addCadence(new Date('2026-12-15T00:00:00Z'), RecurringCadence.MONTHLY),
      ),
    ).toBe('2027-01-15');
  });

  it('clamps a 31st anchor to the last day of a shorter month', () => {
    expect(
      iso(
        addCadence(
          new Date('2026-01-31T00:00:00Z'),
          RecurringCadence.MONTHLY,
          31,
        ),
      ),
    ).toBe('2026-02-28');
  });

  // The VEG-467 regression test. The subscriptions cron re-derives the
  // day-of-month from the STORED date each run, so a 31st bill degrades to a
  // 28th permanently after its first February. Passing the anchor in keeps the
  // schedule's identity across runs instead of letting a clamp become the new
  // truth.
  it('restores the anchor day after a clamp, run over run', () => {
    const anchor = 31;
    let date = new Date('2026-01-31T00:00:00Z');
    const seen: string[] = [];
    for (let i = 0; i < 5; i++) {
      date = addCadence(date, RecurringCadence.MONTHLY, anchor);
      seen.push(iso(date));
    }
    expect(seen).toEqual([
      '2026-02-28',
      '2026-03-31',
      '2026-04-30',
      '2026-05-31',
      '2026-06-30',
    ]);
  });

  it('restores a 30th anchor after a February clamp', () => {
    const anchor = 30;
    let date = new Date('2026-01-30T00:00:00Z');
    date = addCadence(date, RecurringCadence.MONTHLY, anchor);
    expect(iso(date)).toBe('2026-02-28');
    date = addCadence(date, RecurringCadence.MONTHLY, anchor);
    expect(iso(date)).toBe('2026-03-30');
  });

  it('clamps a 31st anchor into a leap February', () => {
    expect(
      iso(
        addCadence(
          new Date('2028-01-31T00:00:00Z'),
          RecurringCadence.MONTHLY,
          31,
        ),
      ),
    ).toBe('2028-02-29');
  });

  it('falls back to the date own day when no anchor is supplied', () => {
    expect(
      iso(
        addCadence(new Date('2026-01-31T00:00:00Z'), RecurringCadence.MONTHLY),
      ),
    ).toBe('2026-02-28');
  });

  it('steps forward one year', () => {
    expect(
      iso(
        addCadence(new Date('2026-08-01T00:00:00Z'), RecurringCadence.YEARLY),
      ),
    ).toBe('2027-08-01');
  });

  // A Feb-29 yearly schedule must not permanently become Feb 28: the anchor
  // survives the three non-leap clamps and restores on the next leap year.
  it('restores a Feb 29 yearly anchor on the next leap year', () => {
    const anchor = 29;
    let date = new Date('2028-02-29T00:00:00Z');
    const seen: string[] = [];
    for (let i = 0; i < 4; i++) {
      date = addCadence(date, RecurringCadence.YEARLY, anchor);
      seen.push(iso(date));
    }
    expect(seen).toEqual([
      '2029-02-28',
      '2030-02-28',
      '2031-02-28',
      '2032-02-29',
    ]);
  });

  it('preserves the time-of-day of the source instant', () => {
    expect(
      addCadence(
        new Date('2026-08-01T14:30:00Z'),
        RecurringCadence.MONTHLY,
      ).toISOString(),
    ).toBe('2026-09-01T14:30:00.000Z');
  });

  it('does not mutate its input', () => {
    const input = new Date('2026-08-01T00:00:00Z');
    addCadence(input, RecurringCadence.MONTHLY);
    expect(input.toISOString()).toBe('2026-08-01T00:00:00.000Z');
  });
});

describe('daysUntil', () => {
  it('counts whole UTC calendar days, ignoring time-of-day', () => {
    expect(
      daysUntil(
        new Date('2026-10-03T00:00:00Z'),
        new Date('2026-09-30T23:59:00Z'),
      ),
    ).toBe(3);
  });

  it('is 0 for the same UTC day', () => {
    expect(
      daysUntil(
        new Date('2026-10-03T23:59:00Z'),
        new Date('2026-10-03T00:01:00Z'),
      ),
    ).toBe(0);
  });

  it('is negative for a past date', () => {
    expect(
      daysUntil(
        new Date('2026-09-28T00:00:00Z'),
        new Date('2026-09-30T09:00:00Z'),
      ),
    ).toBe(-2);
  });
});

describe('isInReminderWindow', () => {
  const due = new Date('2026-10-10T00:00:00Z');

  it('is true the day before the due date', () => {
    expect(isInReminderWindow(due, 3, new Date('2026-10-09T09:00:00Z'))).toBe(
      true,
    );
  });

  it('is true on the first day of the window', () => {
    expect(isInReminderWindow(due, 3, new Date('2026-10-07T09:00:00Z'))).toBe(
      true,
    );
  });

  it('is false on the due date itself (the materializer handles it)', () => {
    expect(isInReminderWindow(due, 3, new Date('2026-10-10T09:00:00Z'))).toBe(
      false,
    );
  });

  it('is false one day before the window opens', () => {
    expect(isInReminderWindow(due, 3, new Date('2026-10-06T09:00:00Z'))).toBe(
      false,
    );
  });

  it('is false when reminderDaysBefore is 0, even the day before', () => {
    expect(isInReminderWindow(due, 0, new Date('2026-10-09T09:00:00Z'))).toBe(
      false,
    );
  });

  it('ignores time-of-day: 23:59Z due vs 00:01Z now on the same day is still due today', () => {
    expect(
      isInReminderWindow(
        new Date('2026-10-10T23:59:00Z'),
        3,
        new Date('2026-10-10T00:01:00Z'),
      ),
    ).toBe(false);
  });

  it('spans a month boundary', () => {
    expect(
      isInReminderWindow(
        new Date('2026-04-02T00:00:00Z'),
        3,
        new Date('2026-03-31T09:00:00Z'),
      ),
    ).toBe(true);
  });
});

describe('settleTrackedSubscriptionDate', () => {
  const NOW = new Date('2026-05-10T00:00:00Z');
  const tracked = (overrides: Record<string, unknown> = {}) => ({
    isSubscription: true,
    accountId: 'acc',
    isActive: true,
    nextDate: new Date('2026-02-15T00:00:00Z'),
    cadence: RecurringCadence.MONTHLY,
    cadenceAnchorDay: 15 as number | undefined,
    ...overrides,
  });

  it('rolls a past monthly date to the first occurrence on or after today', () => {
    expect(settleTrackedSubscriptionDate(tracked(), NOW)).toEqual(
      new Date('2026-05-15T00:00:00Z'),
    );
  });

  it('rolls a weekly date in 7-day steps', () => {
    const settled = settleTrackedSubscriptionDate(
      tracked({
        cadence: RecurringCadence.WEEKLY,
        nextDate: new Date('2026-04-20T00:00:00Z'),
        cadenceAnchorDay: undefined,
      }),
      NOW,
    );
    // 04-20, 04-27, 05-04, 05-11.
    expect(settled).toEqual(new Date('2026-05-11T00:00:00Z'));
  });

  it('keeps a month-end anchor through short months', () => {
    const settled = settleTrackedSubscriptionDate(
      tracked({
        nextDate: new Date('2026-01-31T00:00:00Z'),
        cadenceAnchorDay: 31,
      }),
      NOW,
    );
    expect(settled).toEqual(new Date('2026-05-31T00:00:00Z'));
  });

  it("uses the starting date's day when no anchor is stored", () => {
    const settled = settleTrackedSubscriptionDate(
      tracked({
        nextDate: new Date('2026-01-31T00:00:00Z'),
        cadenceAnchorDay: undefined,
      }),
      NOW,
    );
    expect(settled).toEqual(new Date('2026-05-31T00:00:00Z'));
  });

  it('keeps a date that falls on today, at any time of day', () => {
    const today = new Date('2026-05-10T18:30:00Z');
    expect(
      settleTrackedSubscriptionDate(tracked({ nextDate: today }), NOW),
    ).toBe(today);
  });

  it.each([
    ['an ordinary bill', { isSubscription: false }],
    ['an account-less subscription', { accountId: undefined }],
    ['a paused subscription', { isActive: false }],
  ])('leaves the date of %s alone', (_label, overrides) => {
    const state = tracked(overrides);
    expect(settleTrackedSubscriptionDate(state, NOW)).toBe(state.nextDate);
  });
});
