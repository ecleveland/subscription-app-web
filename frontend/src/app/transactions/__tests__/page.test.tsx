import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

let accountsState: {
  accounts: unknown[];
  error: string | null;
  refresh: () => Promise<void>;
};
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
  default: (props: { categories: { name: string }[] }) => (
    <div>
      TransactionFormStub:{props.categories.map((c) => c.name).join(',')}
    </div>
  ),
}));
vi.mock('@/components/CsvImportWizard', () => ({
  default: (props: { onImported: () => void }) => (
    <div>
      CsvImportWizardStub
      <button onClick={props.onImported}>stub-import</button>
    </div>
  ),
}));

import { listTransactions, deleteTransaction } from '@/lib/transactions';
import { listCategories } from '@/lib/categories';
import { showSuccessToast, showErrorToast } from '@/lib/toast';
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
    accountsState = {
      accounts,
      error: null,
      refresh: vi.fn().mockResolvedValue(undefined),
    };
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

  it('surfaces an accounts-load error instead of "create an account"', async () => {
    accountsState = { accounts: [], error: 'boom', refresh: vi.fn() };
    mockList([]);
    render(<TransactionsPage />);

    expect(await screen.findByText(/Couldn.t load accounts: boom/)).toBeInTheDocument();
    expect(
      screen.queryByText('Create an account before recording transactions.'),
    ).toBeNull();
  });

  it('shows an error (not empty state) when the list fetch fails', async () => {
    vi.mocked(listTransactions).mockRejectedValue(new Error('list fail'));
    render(<TransactionsPage />);

    expect(
      await screen.findByText(/Couldn.t load transactions: list fail/),
    ).toBeInTheDocument();
    expect(screen.queryByText('No transactions found.')).toBeNull();
  });

  it('shows archived category names on historical rows but hides them from the filter', async () => {
    const archivedCategory: BudgetCategory = {
      _id: 'c2',
      householdId: 'h',
      groupId: 'g',
      name: 'Old Hobby',
      isIncome: false,
      sortOrder: 1,
      isArchived: true,
      createdAt: '',
      updatedAt: '',
    };
    vi.mocked(listCategories).mockResolvedValue([
      ...categories,
      archivedCategory,
    ]);
    mockList([{ ...txn, _id: 't2', categoryId: 'c2', payee: undefined }]);
    render(<TransactionsPage />);

    // The archived category's name still labels its historical transaction…
    expect(await screen.findByText('Old Hobby')).toBeInTheDocument();
    expect(listCategories).toHaveBeenCalledWith(true);

    // …but it is not offered in the category filter.
    const filter = screen.getByLabelText('Filter by category');
    expect(
      within(filter).queryByRole('option', { name: 'Old Hobby' }),
    ).toBeNull();
    expect(
      within(filter).getByRole('option', { name: 'Groceries' }),
    ).toBeInTheDocument();
  });

  it('offers an archived category to the form only when editing its own transaction', async () => {
    const archivedCategory: BudgetCategory = {
      _id: 'c2',
      householdId: 'h',
      groupId: 'g',
      name: 'Old Hobby',
      isIncome: false,
      sortOrder: 1,
      isArchived: true,
      createdAt: '',
      updatedAt: '',
    };
    vi.mocked(listCategories).mockResolvedValue([
      ...categories,
      archivedCategory,
    ]);
    mockList([{ ...txn, _id: 't2', categoryId: 'c2', payee: undefined }]);
    const user = userEvent.setup();
    render(<TransactionsPage />);
    await screen.findByText('Old Hobby');

    // Creating a new transaction: archived categories are not offered.
    await user.click(
      screen.getByRole('button', { name: '+ Add transaction' }),
    );
    expect(screen.getByText(/TransactionFormStub:/)).not.toHaveTextContent(
      'Old Hobby',
    );

    // Editing the archived-category transaction: its category stays selectable.
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    expect(screen.getByText(/TransactionFormStub:/)).toHaveTextContent(
      'Old Hobby',
    );
  });

  it('does not offer archived categories when editing an active-category transaction', async () => {
    const archivedCategory: BudgetCategory = {
      _id: 'c2',
      householdId: 'h',
      groupId: 'g',
      name: 'Old Hobby',
      isIncome: false,
      sortOrder: 1,
      isArchived: true,
      createdAt: '',
      updatedAt: '',
    };
    vi.mocked(listCategories).mockResolvedValue([
      ...categories,
      archivedCategory,
    ]);
    mockList([txn]);
    const user = userEvent.setup();
    render(<TransactionsPage />);
    await screen.findByText('-$42.00');

    await user.click(screen.getByRole('button', { name: 'Edit' }));
    const stub = screen.getByText(/TransactionFormStub:/);
    expect(stub).toHaveTextContent('Groceries');
    expect(stub).not.toHaveTextContent('Old Hobby');
  });

  it('toasts when categories fail to load', async () => {
    mockList([]);
    vi.mocked(listCategories).mockRejectedValue(new Error('no cats'));
    render(<TransactionsPage />);

    await waitFor(() =>
      expect(showErrorToast).toHaveBeenCalledWith('no cats'),
    );
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

  it('opens the CSV import wizard and hides the action buttons', async () => {
    mockList([]);
    const user = userEvent.setup();
    render(<TransactionsPage />);
    await screen.findByText('No transactions found.');

    await user.click(screen.getByRole('button', { name: 'Import CSV' }));

    expect(screen.getByText('CsvImportWizardStub')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Import CSV' })).toBeNull();
    expect(screen.queryByRole('button', { name: '+ Add transaction' })).toBeNull();
  });

  it('warns when balances fail to refresh after an import', async () => {
    accountsState = {
      accounts,
      error: null,
      refresh: vi.fn().mockRejectedValue(new Error('refresh fail')),
    };
    mockList([]);
    const user = userEvent.setup();
    render(<TransactionsPage />);
    await screen.findByText('No transactions found.');

    await user.click(screen.getByRole('button', { name: 'Import CSV' }));
    await user.click(screen.getByRole('button', { name: 'stub-import' }));

    await waitFor(() =>
      expect(showErrorToast).toHaveBeenCalledWith(
        'Saved, but balances may be out of date — refresh to update.',
      ),
    );
  });

  it('disables the import button until an account exists', async () => {
    accountsState = { accounts: [], error: null, refresh: vi.fn() };
    mockList([]);
    render(<TransactionsPage />);
    expect(await screen.findByRole('button', { name: 'Import CSV' })).toBeDisabled();
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
