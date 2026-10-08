import { monthIndex, monthsInRange } from './month-range.util';

describe('month-range util', () => {
  describe('monthIndex', () => {
    it('counts months since year 0 so ranges can be compared with subtraction', () => {
      expect(monthIndex('2026-04') - monthIndex('2026-03')).toBe(1);
      expect(monthIndex('2027-01') - monthIndex('2026-12')).toBe(1);
    });
  });

  describe('monthsInRange', () => {
    it('lists every month from from to to inclusive', () => {
      expect(monthsInRange('2026-11', '2027-02')).toEqual([
        '2026-11',
        '2026-12',
        '2027-01',
        '2027-02',
      ]);
    });

    it('returns a single month when from equals to', () => {
      expect(monthsInRange('2026-03', '2026-03')).toEqual(['2026-03']);
    });

    it('returns an empty list when from is after to', () => {
      expect(monthsInRange('2026-04', '2026-03')).toEqual([]);
    });
  });
});
