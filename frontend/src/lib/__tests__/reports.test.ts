vi.mock('../api', () => ({ apiFetch: vi.fn() }));

import { apiFetch } from '../api';
import {
  getCashFlow,
  getSpending,
  getNetWorth,
  defaultRange,
  monthSpan,
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
