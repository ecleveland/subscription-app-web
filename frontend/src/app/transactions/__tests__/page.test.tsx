import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

let accountsState: {
  accounts: unknown[];
  error: string | null;
  refresh: () => Promise<void>;
};
vi.mock('@/lib/accounts-context', () => ({ useAccounts: () => accountsState }));
// Overrides the global next/navigation mock so a test can seed ?recurringId=
// and assert the Clear-filter navigation.
let searchParamsState = new URLSearchParams();
const { mockReplace } = vi.hoisted(() => ({ mockReplace: vi.fn() }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: mockReplace, back: vi.fn(), prefetch: vi.fn() }),
  useParams: () => ({}),
  useSearchParams: () => searchParamsState,
}));
vi.mock('@/lib/transactions', () => ({
  listTransactions: vi.fn(),
  deleteTransaction: vi.fn(),
}));
vi.mock('@/lib/categories', () => ({ listCategories: vi.fn() }));
vi.mock('@/lib/labels', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/labels')>()),
  listLabels: vi.fn(),
}));
vi.mock('@/lib/toast', () => ({
  showErrorToast: vi.fn(),
  showSuccessToast: vi.fn(),
}));
vi.mock('@/components/TransactionForm', async () => {
  const { useState } = await import('react');
  function TransactionFormStub(props: {
    transaction?: { _id: string };
    categories: { name: string }[];
    labels: { name: string }[];
  }) {
    // Captured on mount only, like the real form's useState initializers —
    // lets tests assert the page remounts the form when the target changes.
    const [mountedFor] = useState(props.transaction?._id ?? 'new');
    return (
      <div>
        TransactionFormStub:mounted-for={mountedFor};
        {props.categories.map((c) => c.name).join(',')};labels=
        {props.labels.map((l) => l.name).join(',')}
      </div>
    );
  }
  return { default: TransactionFormStub };
});
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
import { listLabels } from '@/lib/labels';
import { showSuccessToast, showErrorToast } from '@/lib/toast';
import TransactionsPage from '@/app/transactions/page';
import type { Account, BudgetCategory, Label, Transaction } from '@/lib/types';

const accounts: Account[] = [
  { _id: 'a1', householdId: 'h', name: 'Checking', type: 'checking', balanceCents: 0, isArchived: false, createdAt: '', updatedAt: '' },
];
const categories: BudgetCategory[] = [
  { _id: 'c1', householdId: 'h', groupId: 'g', name: 'Groceries', isIncome: false, sortOrder: 0, isArchived: false, createdAt: '', updatedAt: '' },
];
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
const labels: Label[] = [
  { _id: 'l1', householdId: 'h', name: 'Etsy shop', color: '#2f8a93', isArchived: false, createdAt: '', updatedAt: '' },
  { _id: 'l2', householdId: 'h', name: 'Old gig', color: '#6b4f9e', isArchived: true, createdAt: '', updatedAt: '' },
];

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
    searchParamsState = new URLSearchParams();
    mockReplace.mockClear();
    accountsState = {
      accounts,
      error: null,
      refresh: vi.fn().mockResolvedValue(undefined),
    };
    vi.mocked(listCategories).mockResolvedValue(categories);
    vi.mocked(listLabels).mockResolvedValue(labels);
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

  it('labels historical rows with archived category names and marks them in the filter', async () => {
    vi.mocked(listCategories).mockResolvedValue([
      ...categories,
      archivedCategory,
    ]);
    mockList([{ ...txn, _id: 't2', categoryId: 'c2', payee: undefined }]);
    render(<TransactionsPage />);

    // The archived category's name still labels its historical transaction…
    expect(await screen.findByText('Old Hobby')).toBeInTheDocument();
    expect(listCategories).toHaveBeenCalledWith(true);

    // …and stays filterable (rows show it, so the filter must offer it),
    // flagged so it isn't mistaken for an active category.
    const filter = screen.getByLabelText('Filter by category');
    expect(
      within(filter).getByRole('option', { name: 'Old Hobby (archived)' }),
    ).toBeInTheDocument();
    expect(
      within(filter).getByRole('option', { name: 'Groceries' }),
    ).toBeInTheDocument();
  });

  it('remounts the form when switching Edit between transactions', async () => {
    mockList([txn, { ...txn, _id: 't2', payee: 'Cafe' }]);
    const user = userEvent.setup();
    render(<TransactionsPage />);
    await screen.findByText(/Store/);

    await user.click(screen.getAllByRole('button', { name: 'Edit' })[0]);
    expect(screen.getByText(/TransactionFormStub:/)).toHaveTextContent(
      'mounted-for=t1',
    );

    // Switching targets must remount, or the form keeps t1's field state and
    // Update would overwrite t2 with it.
    await user.click(screen.getAllByRole('button', { name: 'Edit' })[1]);
    expect(screen.getByText(/TransactionFormStub:/)).toHaveTextContent(
      'mounted-for=t2',
    );
  });

  it('offers an archived category to the form only when editing its own transaction', async () => {
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

  it('seeds the filter from ?recurringId= and lets the user clear it', async () => {
    searchParamsState = new URLSearchParams('recurringId=r1');
    mockList([txn]);
    const user = userEvent.setup();
    render(<TransactionsPage />);

    await screen.findByText('-$42.00');
    await waitFor(() =>
      expect(
        vi
          .mocked(listTransactions)
          .mock.calls.some((c) => c[0]?.recurringId === 'r1'),
      ).toBe(true),
    );
    expect(
      screen.getByText(/generated by one recurring schedule/i),
    ).toBeInTheDocument();

    // Clearing strips the param (the source of truth) via router.replace.
    await user.click(screen.getByRole('button', { name: /clear filter/i }));
    expect(mockReplace).toHaveBeenCalledWith('/transactions');
  });

  it('re-applies the filter when the URL recurringId changes without a remount', async () => {
    // First History click.
    searchParamsState = new URLSearchParams('recurringId=r1');
    mockList([txn]);
    const { rerender } = render(<TransactionsPage />);
    await waitFor(() =>
      expect(
        vi
          .mocked(listTransactions)
          .mock.calls.some((c) => c[0]?.recurringId === 'r1'),
      ).toBe(true),
    );

    // Second History click: same route, new query param, no remount.
    searchParamsState = new URLSearchParams('recurringId=r2');
    rerender(<TransactionsPage />);
    await waitFor(() =>
      expect(
        vi
          .mocked(listTransactions)
          .mock.calls.some((c) => c[0]?.recurringId === 'r2'),
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

  describe('labels', () => {
    function lastFilters() {
      return vi.mocked(listTransactions).mock.calls.at(-1)?.[0];
    }

    it('fetches labels with archived ones and lists them in the filter', async () => {
      mockList([txn]);
      render(<TransactionsPage />);
      await screen.findByText('-$42.00');

      expect(listLabels).toHaveBeenCalledWith(true);
      const filter = screen.getByLabelText('Filter by label');
      await within(filter).findByRole('option', { name: 'Etsy shop' });
      expect(within(filter).getByRole('option', { name: 'All labels' })).toBeInTheDocument();
      expect(within(filter).getByRole('option', { name: 'Personal' })).toBeInTheDocument();
      expect(
        within(filter).getByRole('option', { name: 'Old gig (archived)' }),
      ).toBeInTheDocument();
    });

    it('filters by Personal, by a label, and back to all labels', async () => {
      mockList([txn]);
      const user = userEvent.setup();
      render(<TransactionsPage />);
      await screen.findByText('-$42.00');
      const filter = screen.getByLabelText('Filter by label');
      await within(filter).findByRole('option', { name: 'Etsy shop' });

      await user.selectOptions(filter, 'none');
      await waitFor(() => expect(lastFilters()).toMatchObject({ labelId: 'none', page: 1 }));

      await user.selectOptions(filter, 'l1');
      await waitFor(() => expect(lastFilters()).toMatchObject({ labelId: 'l1' }));

      await user.selectOptions(filter, '');
      await waitFor(() => expect(lastFilters()?.labelId).toBeUndefined());
    });

    it('shows a chip on a labeled row and none on a personal row', async () => {
      mockList([
        { ...txn, _id: 't1', payee: 'Kiln parts', labelId: 'l1' },
        { ...txn, _id: 't2', payee: 'Groceries run' },
      ]);
      render(<TransactionsPage />);

      const labeledRow = (await screen.findByText('Kiln parts')).closest('li')!;
      expect(await within(labeledRow).findByText('Etsy shop')).toBeInTheDocument();
      const personalRow = screen.getByText('Groceries run').closest('li')!;
      expect(within(personalRow).queryByText('Etsy shop')).toBeNull();
    });

    it('marks owed and reimbursed rows and leaves a personal row unmarked', async () => {
      mockList([
        { ...txn, _id: 't1', payee: 'Kiln parts', labelId: 'l1', reimbursement: { status: 'owed' } },
        {
          ...txn,
          _id: 't2',
          payee: 'Glaze order',
          labelId: 'l1',
          reimbursement: { status: 'reimbursed', reimbursedAt: '2026-06-10T00:00:00.000Z' },
        },
        { ...txn, _id: 't3', payee: 'Groceries run' },
      ]);
      render(<TransactionsPage />);

      const owedRow = (await screen.findByText('Kiln parts')).closest('li')!;
      expect(within(owedRow).getByText('Owed')).toBeInTheDocument();
      expect(within(owedRow).queryByText('Reimbursed')).toBeNull();
      const reimbursedRow = screen.getByText('Glaze order').closest('li')!;
      expect(within(reimbursedRow).getByText('Reimbursed')).toBeInTheDocument();
      expect(within(reimbursedRow).queryByText('Owed')).toBeNull();
      const personalRow = screen.getByText('Groceries run').closest('li')!;
      expect(within(personalRow).queryByText('Owed')).toBeNull();
      expect(within(personalRow).queryByText('Reimbursed')).toBeNull();
    });

    it('passes the labels to the form', async () => {
      mockList([]);
      const user = userEvent.setup();
      render(<TransactionsPage />);
      await screen.findByText('No transactions found.');
      await within(screen.getByLabelText('Filter by label')).findByRole('option', {
        name: 'Etsy shop',
      });

      await user.click(screen.getByRole('button', { name: '+ Add transaction' }));
      expect(screen.getByText(/TransactionFormStub:/)).toHaveTextContent(
        'labels=Etsy shop,Old gig',
      );
    });

    it('toasts when labels fail to load', async () => {
      mockList([]);
      vi.mocked(listLabels).mockRejectedValue(new Error('no labels'));
      render(<TransactionsPage />);

      await waitFor(() => expect(showErrorToast).toHaveBeenCalledWith('no labels'));
    });
  });
});
