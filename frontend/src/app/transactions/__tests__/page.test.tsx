import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

let accountsState: { accounts: unknown[]; refresh: () => Promise<void> };
vi.mock('@/lib/accounts-context', () => ({ useAccounts: () => accountsState }));
vi.mock('@/lib/transactions', () => ({
  listTransactions: vi.fn(),
  deleteTransaction: vi.fn(),
}));
vi.mock('@/lib/categories', () => ({ listCategories: vi.fn() }));
vi.mock('@/lib/toast', () => ({
  showErrorToast: vi.fn(),
  showSuccessToast: vi.fn(),
}));
vi.mock('@/components/TransactionForm', () => ({
  default: () => <div>TransactionFormStub</div>,
}));

import { listTransactions, deleteTransaction } from '@/lib/transactions';
import { listCategories } from '@/lib/categories';
import { showSuccessToast } from '@/lib/toast';
import TransactionsPage from '@/app/transactions/page';
import type { Account, BudgetCategory, Transaction } from '@/lib/types';

const accounts: Account[] = [
  { _id: 'a1', householdId: 'h', name: 'Checking', type: 'checking', balanceCents: 0, isArchived: false, createdAt: '', updatedAt: '' },
];
const categories: BudgetCategory[] = [
  { _id: 'c1', householdId: 'h', groupId: 'g', name: 'Groceries', isIncome: false, sortOrder: 0, isArchived: false, createdAt: '', updatedAt: '' },
];
const txn: Transaction = {
  _id: 't1',
  householdId: 'h',
  accountId: 'a1',
  categoryId: 'c1',
  type: 'expense',
  amountCents: 4200,
  date: '2026-06-01T00:00:00.000Z',
  payee: 'Store',
  cleared: false,
  createdAt: '',
  updatedAt: '',
};

function mockList(data: Transaction[], total = data.length) {
  vi.mocked(listTransactions).mockResolvedValue({
    data,
    meta: { total, page: 1, limit: 20, totalPages: 1, hasNextPage: false },
  });
}

describe('TransactionsPage', () => {
  beforeAll(() => {
    HTMLDialogElement.prototype.showModal = vi.fn();
    HTMLDialogElement.prototype.close = vi.fn();
  });
  beforeEach(() => {
    accountsState = { accounts, refresh: vi.fn().mockResolvedValue(undefined) };
    vi.mocked(listCategories).mockResolvedValue(categories);
  });
  afterEach(() => vi.clearAllMocks());

  it('renders transactions with a signed amount', async () => {
    mockList([txn]);
    render(<TransactionsPage />);

    expect(await screen.findByText('-$42.00')).toBeInTheDocument();
    expect(screen.getByText(/Store/)).toBeInTheDocument();
  });

  it('shows the empty state', async () => {
    mockList([]);
    render(<TransactionsPage />);
    expect(await screen.findByText('No transactions found.')).toBeInTheDocument();
  });

  it('re-fetches when the type filter changes', async () => {
    mockList([txn]);
    const user = userEvent.setup();
    render(<TransactionsPage />);
    await screen.findByText('-$42.00');

    await user.selectOptions(screen.getByLabelText('Filter by type'), 'income');

    await waitFor(() =>
      expect(
        vi
          .mocked(listTransactions)
          .mock.calls.some((c) => c[0]?.type === 'income'),
      ).toBe(true),
    );
  });

  it('deletes a transaction through the confirm dialog', async () => {
    mockList([txn]);
    vi.mocked(deleteTransaction).mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<TransactionsPage />);
    await screen.findByText('-$42.00');

    await user.click(screen.getByRole('button', { name: 'Delete' }));
    await user.click(
      screen.getAllByRole('button', { name: 'Delete', hidden: true }).at(-1)!,
    );

    await waitFor(() => expect(deleteTransaction).toHaveBeenCalledWith('t1'));
    expect(showSuccessToast).toHaveBeenCalledWith('Transaction deleted');
  });
});
