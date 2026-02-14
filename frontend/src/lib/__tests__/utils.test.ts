import { formatCurrency, formatDate, getDailyCost, getWeeklyCost, getMonthlyCost, getYearlyCost, daysUntil } from '../utils';

describe('formatCurrency', () => {
  it('should format a typical price', () => {
    expect(formatCurrency(15.99)).toBe('$15.99');
  });

  it('should format zero', () => {
    expect(formatCurrency(0)).toBe('$0.00');
  });

  it('should format large numbers with commas', () => {
    expect(formatCurrency(1234.5)).toBe('$1,234.50');
  });

  it('should round to two decimal places', () => {
    expect(formatCurrency(9.999)).toBe('$10.00');
  });
});

describe('formatDate', () => {
  it('should format a date string', () => {
    // Use full ISO string to avoid timezone-dependent date-only parsing
    expect(formatDate('2025-03-15T00:00:00')).toBe('Mar 15, 2025');
  });

  it('should format a Date object', () => {
    expect(formatDate(new Date('2025-12-25T00:00:00'))).toBe('Dec 25, 2025');
  });
});

describe('getMonthlyCost', () => {
  it('should return cost as-is for monthly billing', () => {
    expect(getMonthlyCost(15, 'monthly')).toBe(15);
  });

  it('should divide by 12 for yearly billing', () => {
    expect(getMonthlyCost(120, 'yearly')).toBe(10);
  });

  it('should multiply by 4.33 for weekly billing', () => {
    expect(getMonthlyCost(10, 'weekly')).toBeCloseTo(43.3, 1);
  });
});

describe('getYearlyCost', () => {
  it('should multiply by 12 for monthly billing', () => {
    expect(getYearlyCost(15, 'monthly')).toBe(180);
  });

  it('should return cost as-is for yearly billing', () => {
    expect(getYearlyCost(120, 'yearly')).toBe(120);
  });

  it('should multiply by 52.14 for weekly billing', () => {
    expect(getYearlyCost(10, 'weekly')).toBeCloseTo(521.4, 1);
  });
});

describe('getDailyCost', () => {
  it('should convert monthly cost to daily', () => {
    // $30.44/month (365/12) → $1/day
    expect(getDailyCost(365 / 12, 'monthly')).toBeCloseTo(1, 5);
  });

  it('should convert yearly cost to daily', () => {
    // $365/year → $1/day
    expect(getDailyCost(365, 'yearly')).toBeCloseTo(1, 5);
  });

  it('should divide by 7 for weekly billing', () => {
    expect(getDailyCost(7, 'weekly')).toBeCloseTo(1, 5);
  });
});

describe('getWeeklyCost', () => {
  it('should convert monthly cost to weekly', () => {
    // $365/12 per month → $7/week
    expect(getWeeklyCost(365 / 12, 'monthly')).toBeCloseTo(7, 5);
  });

  it('should convert yearly cost to weekly', () => {
    // $365/year → $7/week
    expect(getWeeklyCost(365, 'yearly')).toBeCloseTo(7, 5);
  });

  it('should return cost as-is for weekly billing', () => {
    expect(getWeeklyCost(25, 'weekly')).toBe(25);
  });
});

describe('daysUntil', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-06-15T12:00:00'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should return positive days for a future date', () => {
    expect(daysUntil('2025-06-20T12:00:00')).toBe(5);
  });

  it('should return negative days for a past date', () => {
    expect(daysUntil('2025-06-10T12:00:00')).toBe(-5);
  });

  it('should return 0 for the current date at same time', () => {
    expect(daysUntil('2025-06-15T12:00:00')).toBe(0);
  });

  it('should return 1 when the target is tomorrow', () => {
    expect(daysUntil('2025-06-16T12:00:00')).toBe(1);
  });
});
