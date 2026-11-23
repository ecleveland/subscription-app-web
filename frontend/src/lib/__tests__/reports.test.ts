vi.mock('../api', () => ({ apiFetch: vi.fn() }));

import { apiFetch } from '../api';
import {
  getCashFlow,
  getSpending,
  getNetWorth,
  getBusinessReport,
  formatSignedCents,
  defaultRange,
  monthSpan,
  isValidMonth,
  MAX_REPORT_MONTHS,
} from '../reports';

describe('reports api helpers', () => {
  beforeEach(() => {
    vi.mocked(apiFetch).mockReset();
    vi.mocked(apiFetch).mockResolvedValue({});
  });

  it('getCashFlow requests the cash-flow route with from and to', async () => {
    await getCashFlow('2025-11', '2026-10');
    expect(apiFetch).toHaveBeenCalledWith(
      '/reports/cash-flow?from=2025-11&to=2026-10',
    );
  });

  it('getSpending requests the spending route for one month', async () => {
    await getSpending('2026-10');
    expect(apiFetch).toHaveBeenCalledWith('/reports/spending?month=2026-10');
  });

  it('getNetWorth requests the net-worth route with from and to', async () => {
    await getNetWorth('2025-11', '2026-10');
    expect(apiFetch).toHaveBeenCalledWith(
      '/reports/net-worth?from=2025-11&to=2026-10',
    );
  });
});

describe('label filter', () => {
  beforeEach(() => {
    vi.mocked(apiFetch).mockReset();
    vi.mocked(apiFetch).mockResolvedValue({});
  });

  it('appends labelId to the cash flow, spending and net worth routes when set', async () => {
    await getCashFlow('2025-11', '2026-10', 'l1');
    expect(apiFetch).toHaveBeenCalledWith(
      '/reports/cash-flow?from=2025-11&to=2026-10&labelId=l1',
    );
    await getSpending('2026-10', 'none');
    expect(apiFetch).toHaveBeenCalledWith(
      '/reports/spending?month=2026-10&labelId=none',
    );
    await getNetWorth('2025-11', '2026-10', 'any');
    expect(apiFetch).toHaveBeenCalledWith(
      '/reports/net-worth?from=2025-11&to=2026-10&labelId=any',
    );
  });

  it('leaves labelId off when it is empty', async () => {
    await getCashFlow('2025-11', '2026-10', '');
    expect(apiFetch).toHaveBeenCalledWith(
      '/reports/cash-flow?from=2025-11&to=2026-10',
    );
  });

  it('encodes the label id so it cannot add query parameters', async () => {
    await getSpending('2026-10', 'l1&month=1999-01');
    expect(apiFetch).toHaveBeenCalledWith(
      '/reports/spending?month=2026-10&labelId=l1%26month%3D1999-01',
    );
  });

  it('getBusinessReport requests every label when no label is given', async () => {
    await getBusinessReport('2025-11', '2026-10');
    expect(apiFetch).toHaveBeenCalledWith(
      '/reports/business?from=2025-11&to=2026-10',
    );
  });

  it('getBusinessReport scopes to one label when given', async () => {
    await getBusinessReport('2025-11', '2026-10', 'l1');
    expect(apiFetch).toHaveBeenCalledWith(
      '/reports/business?from=2025-11&to=2026-10&labelId=l1',
    );
  });
});

describe('formatSignedCents', () => {
  it('prefixes a rise with a plus sign', () => {
    expect(formatSignedCents(12000)).toBe('+$120.00');
  });

  it('keeps the minus sign on a drop', () => {
    expect(formatSignedCents(-4000)).toBe('-$40.00');
  });

  it('shows zero without a sign', () => {
    expect(formatSignedCents(0)).toBe('$0.00');
  });
});

describe('query encoding', () => {
  beforeEach(() => {
    vi.mocked(apiFetch).mockReset();
    vi.mocked(apiFetch).mockResolvedValue({});
  });

  it('encodes month values so they cannot add query parameters', async () => {
    await getSpending('2026-10&month=1999-01');
    expect(apiFetch).toHaveBeenCalledWith(
      '/reports/spending?month=2026-10%26month%3D1999-01',
    );
    await getCashFlow('2025-11#x', '2026-10 ');
    expect(apiFetch).toHaveBeenCalledWith(
      '/reports/cash-flow?from=2025-11%23x&to=2026-10%20',
    );
    await getNetWorth('a&b', 'c=d');
    expect(apiFetch).toHaveBeenCalledWith(
      '/reports/net-worth?from=a%26b&to=c%3Dd',
    );
  });
});

describe('defaultRange', () => {
  it('covers the last 12 months including the current UTC month', () => {
    expect(defaultRange(new Date('2026-10-08T12:00:00Z'))).toEqual({
      from: '2025-11',
      to: '2026-10',
    });
  });

  it('uses the UTC month near a month boundary', () => {
    expect(defaultRange(new Date('2026-01-01T00:30:00Z'))).toEqual({
      from: '2025-02',
      to: '2026-01',
    });
  });

  it('spans exactly 12 months', () => {
    const { from, to } = defaultRange(new Date('2026-10-08T12:00:00Z'));
    expect(monthSpan(from, to)).toBe(12);
  });
});

describe('monthSpan', () => {
  it('counts both ends', () => {
    expect(monthSpan('2026-10', '2026-10')).toBe(1);
    expect(monthSpan('2025-12', '2026-01')).toBe(2);
  });

  it('allows exactly the backend cap and flags one more', () => {
    expect(MAX_REPORT_MONTHS).toBe(36);
    expect(monthSpan('2023-11', '2026-10')).toBe(36);
    expect(monthSpan('2023-10', '2026-10')).toBe(37);
  });

  it('is zero or negative when from is after to', () => {
    expect(monthSpan('2026-10', '2026-09')).toBe(0);
    expect(monthSpan('2026-10', '2026-01')).toBeLessThan(0);
  });
});

describe('isValidMonth', () => {
  it('accepts YYYY-MM months', () => {
    expect(isValidMonth('2026-01')).toBe(true);
    expect(isValidMonth('2026-12')).toBe(true);
  });

  it.each(['', 'abc', '2026-1', '2026-0', '2026-00', '2026-13', '26-01', '2026-01-01', ' 2026-01'])(
    'rejects %j',
    (value) => {
      expect(isValidMonth(value)).toBe(false);
    },
  );
});
