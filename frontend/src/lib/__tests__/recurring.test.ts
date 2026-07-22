vi.mock('../api', () => ({ apiFetch: vi.fn() }));

import { apiFetch } from '../api';
import {
  listRecurring,
  createRecurring,
  updateRecurring,
  deleteRecurring,
  upcomingWithin,
  signedCents,
  cadenceLabel,
} from '../recurring';
import type { RecurringTransaction } from '../types';

/** An ISO date-only string offset from today by whole UTC days. */
function dayOffset(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}

function makeRecurring(
  overrides: Partial<RecurringTransaction> = {},
): RecurringTransaction {
  return {
    _id: 'r1',
    householdId: 'h1',
    accountId: 'a1',
    categoryId: 'c1',
    type: 'expense',
    amountCents: 1500,
    payee: 'Netflix',
    cadence: 'monthly',
    nextDate: dayOffset(5),
    reminderDaysBefore: 3,
    isActive: true,
    isSubscription: false,
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
    ...overrides,
  };
}

describe('recurring api wrappers', () => {
  afterEach(() => vi.clearAllMocks());

  it('listRecurring builds a query string from filters and omits empties', async () => {
    await listRecurring({ type: 'expense', isActive: true, accountId: '' });
    const path = vi.mocked(apiFetch).mock.calls[0][0] as string;
    expect(path.startsWith('/recurring?')).toBe(true);
    expect(path).toContain('type=expense');
    expect(path).toContain('isActive=true');
    expect(path).not.toContain('accountId');
  });

  it('listRecurring with no filters hits the bare path (plain array, not paginated)', async () => {
    vi.mocked(apiFetch).mockResolvedValueOnce([]);
    await listRecurring();
    expect(apiFetch).toHaveBeenCalledWith('/recurring');
  });

  it('createRecurring POSTs the body', async () => {
    await createRecurring({
      accountId: 'a1',
      categoryId: 'c1',
      type: 'expense',
      amountCents: 1500,
      payee: 'Netflix',
      cadence: 'monthly',
      nextDate: '2026-08-01',
    });
    expect(apiFetch).toHaveBeenCalledWith('/recurring', {
      method: 'POST',
      body: expect.stringContaining('"amountCents":1500'),
    });
  });

  it('updateRecurring PATCHes and deleteRecurring DELETEs', async () => {
    await updateRecurring('r1', { amountCents: 2000 });
    expect(apiFetch).toHaveBeenCalledWith('/recurring/r1', {
      method: 'PATCH',
      body: JSON.stringify({ amountCents: 2000 }),
    });
    await deleteRecurring('r1');
    expect(apiFetch).toHaveBeenCalledWith('/recurring/r1', { method: 'DELETE' });
  });
});

describe('recurring pure helpers', () => {
  describe('upcomingWithin', () => {
    it('includes schedules due today through +N days', () => {
      const list = [
        makeRecurring({ _id: 'today', nextDate: dayOffset(0) }),
        makeRecurring({ _id: 'soon', nextDate: dayOffset(29) }),
      ];
      const result = upcomingWithin(list, 30);
      expect(result.map((r) => r._id)).toEqual(['today', 'soon']);
    });

    it('includes the exact boundary day and excludes the day after', () => {
      const list = [
        makeRecurring({ _id: 'edge', nextDate: dayOffset(30) }),
        makeRecurring({ _id: 'over', nextDate: dayOffset(31) }),
      ];
      const result = upcomingWithin(list, 30);
      expect(result.map((r) => r._id)).toEqual(['edge']);
    });

    it('excludes schedules beyond the window and in the past', () => {
      const list = [
        makeRecurring({ _id: 'far', nextDate: dayOffset(45) }),
        makeRecurring({ _id: 'past', nextDate: dayOffset(-3) }),
      ];
      expect(upcomingWithin(list, 30)).toEqual([]);
    });

    it('excludes inactive (paused) schedules even if due soon', () => {
      const list = [
        makeRecurring({ _id: 'paused', nextDate: dayOffset(2), isActive: false }),
      ];
      expect(upcomingWithin(list, 30)).toEqual([]);
    });
  });

  describe('signedCents', () => {
    it('prefixes income with + and expense with -', () => {
      expect(signedCents('income', 5000)).toBe('+$50.00');
      expect(signedCents('expense', 4200)).toBe('-$42.00');
    });
  });

  describe('cadenceLabel', () => {
    it('capitalizes the cadence', () => {
      expect(cadenceLabel('weekly')).toBe('Weekly');
      expect(cadenceLabel('monthly')).toBe('Monthly');
      expect(cadenceLabel('yearly')).toBe('Yearly');
    });
  });
});
