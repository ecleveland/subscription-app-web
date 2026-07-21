import { addCadence } from './recurring-dates.util';
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
