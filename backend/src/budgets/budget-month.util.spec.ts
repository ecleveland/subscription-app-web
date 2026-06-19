import { isValidMonth, monthToUtcRange } from './budget-month.util';

describe('budget-month util', () => {
  describe('isValidMonth', () => {
    it.each(['2026-01', '2026-12', '2000-06', '1999-09'])(
      'accepts %s',
      (month) => {
        expect(isValidMonth(month)).toBe(true);
      },
    );

    it.each([
      '2026-1',
      '2026-13',
      '2026-00',
      '26-06',
      '2026/06',
      '2026-06-01',
      '',
      'not-a-month',
    ])('rejects %s', (month) => {
      expect(isValidMonth(month)).toBe(false);
    });
  });

  describe('monthToUtcRange', () => {
    it('maps a month to its first instant and the next month’s first instant (UTC)', () => {
      const { start, end } = monthToUtcRange('2026-06');
      expect(start.toISOString()).toBe('2026-06-01T00:00:00.000Z');
      expect(end.toISOString()).toBe('2026-07-01T00:00:00.000Z');
    });

    it('rolls over the year for December', () => {
      const { start, end } = monthToUtcRange('2025-12');
      expect(start.toISOString()).toBe('2025-12-01T00:00:00.000Z');
      expect(end.toISOString()).toBe('2026-01-01T00:00:00.000Z');
    });

    it('ends February on March 1 regardless of length', () => {
      expect(monthToUtcRange('2026-02').end.toISOString()).toBe(
        '2026-03-01T00:00:00.000Z',
      );
      // Leap year.
      expect(monthToUtcRange('2028-02').end.toISOString()).toBe(
        '2028-03-01T00:00:00.000Z',
      );
    });

    it('includes the last instant of the month and excludes the next month’s first instant', () => {
      const { start, end } = monthToUtcRange('2026-06');
      const lastInstant = new Date('2026-06-30T23:59:59.999Z');
      const nextMonth = new Date('2026-07-01T00:00:00.000Z');
      expect(lastInstant >= start && lastInstant < end).toBe(true);
      expect(nextMonth < end).toBe(false);
    });

    it('throws on a malformed month', () => {
      expect(() => monthToUtcRange('2026-13')).toThrow();
    });
  });
});
