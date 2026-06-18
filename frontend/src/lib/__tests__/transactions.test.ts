vi.mock('../api', () => ({ apiFetch: vi.fn() }));

import { apiFetch } from '../api';
import {
  listTransactions,
  createTransaction,
  updateTransaction,
  deleteTransaction,
  importTransactions,
} from '../transactions';

describe('transactions api wrappers', () => {
  afterEach(() => vi.clearAllMocks());

  it('listTransactions builds a query string from filters and omits empties', async () => {
    await listTransactions({ accountId: 'a1', type: 'expense', page: 2, categoryId: '' });
    const path = vi.mocked(apiFetch).mock.calls[0][0] as string;
    expect(path.startsWith('/transactions?')).toBe(true);
    expect(path).toContain('accountId=a1');
    expect(path).toContain('type=expense');
    expect(path).toContain('page=2');
    expect(path).not.toContain('categoryId');
  });

  it('listTransactions with no filters hits the bare path', async () => {
    await listTransactions();
    expect(apiFetch).toHaveBeenCalledWith('/transactions');
  });

  it('createTransaction POSTs the body', async () => {
    await createTransaction({
      accountId: 'a1',
      type: 'expense',
      amountCents: 4200,
      date: '2026-06-01',
      categoryId: 'c1',
    });
    expect(apiFetch).toHaveBeenCalledWith('/transactions', {
      method: 'POST',
      body: expect.stringContaining('"amountCents":4200'),
    });
  });

  it('updateTransaction PATCHes and deleteTransaction DELETEs', async () => {
    await updateTransaction('t1', { amountCents: 5000 });
    expect(apiFetch).toHaveBeenCalledWith('/transactions/t1', {
      method: 'PATCH',
      body: JSON.stringify({ amountCents: 5000 }),
    });
    await deleteTransaction('t1');
    expect(apiFetch).toHaveBeenCalledWith('/transactions/t1', { method: 'DELETE' });
  });

  it('importTransactions POSTs accountId, mapping and rows to /transactions/import', async () => {
    const input = {
      accountId: 'a1',
      mapping: { date: 'Date', amount: 'Amount', payee: 'Payee' },
      rows: [{ Date: '2026-06-01', Amount: '-42.00', Payee: 'Store' }],
    };
    await importTransactions(input);
    expect(apiFetch).toHaveBeenCalledWith('/transactions/import', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  });
});
