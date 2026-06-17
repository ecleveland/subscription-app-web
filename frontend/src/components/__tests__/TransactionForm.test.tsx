import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('@/lib/transactions', () => ({
  createTransaction: vi.fn(),
  updateTransaction: vi.fn(),
}));
vi.mock('@/lib/toast', () => ({
  showErrorToast: vi.fn(),
  showSuccessToast: vi.fn(),
}));

import { createTransaction } from '@/lib/transactions';
import { showErrorToast } from '@/lib/toast';
import TransactionForm from '@/components/TransactionForm';
import type { Account, BudgetCategory } from '@/lib/types';

const accounts: Account[] = [
  { _id: 'a1', householdId: 'h', name: 'Checking', type: 'checking', balanceCents: 0, isArchived: false, createdAt: '', updatedAt: '' },
  { _id: 'a2', householdId: 'h', name: 'Savings', type: 'savings', balanceCents: 0, isArchived: false, createdAt: '', updatedAt: '' },
];
const categories: BudgetCategory[] = [
  { _id: 'c1', householdId: 'h', groupId: 'g', name: 'Groceries', isIncome: false, sortOrder: 0, isArchived: false, createdAt: '', updatedAt: '' },
  { _id: 'c2', householdId: 'h', groupId: 'g', name: 'Paycheck', isIncome: true, sortOrder: 0, isArchived: false, createdAt: '', updatedAt: '' },
];

function renderForm(extra = {}) {
  return render(
    <TransactionForm
      accounts={accounts}
      categories={categories}
      onSaved={vi.fn()}
      onCancel={vi.fn()}
      {...extra}
    />,
  );
}

describe('TransactionForm', () => {
  afterEach(() => vi.clearAllMocks());

  it('creates an expense with amount converted to cents', async () => {
    const user = userEvent.setup();
    vi.mocked(createTransaction).mockResolvedValue({} as never);

    renderForm();
    await user.selectOptions(screen.getByLabelText('Category'), 'c1');
    await user.type(screen.getByLabelText('Amount ($)'), '42.00');
    // Date defaults to today.
    await user.click(screen.getByRole('button', { name: 'Add' }));

    await waitFor(() =>
      expect(createTransaction).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'expense',
          amountCents: 4200,
          categoryId: 'c1',
          accountId: 'a1',
        }),
      ),
    );
  });

  it('only offers income categories for income type', async () => {
    const user = userEvent.setup();
    renderForm();
    await user.selectOptions(screen.getByLabelText('Type'), 'income');

    const categorySelect = screen.getByLabelText('Category');
    expect(categorySelect).toHaveTextContent('Paycheck');
    expect(categorySelect).not.toHaveTextContent('Groceries');
  });

  it('switches to a destination account for transfers (no category)', async () => {
    const user = userEvent.setup();
    vi.mocked(createTransaction).mockResolvedValue({} as never);

    renderForm();
    await user.selectOptions(screen.getByLabelText('Type'), 'transfer');
    expect(screen.queryByLabelText('Category')).toBeNull();

    await user.selectOptions(screen.getByLabelText('To account'), 'a2');
    await user.type(screen.getByLabelText('Amount ($)'), '100');
    await user.click(screen.getByRole('button', { name: 'Add' }));

    await waitFor(() =>
      expect(createTransaction).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'transfer',
          transferAccountId: 'a2',
          amountCents: 10000,
        }),
      ),
    );
  });

  it('rejects an expense submitted without a category', async () => {
    const user = userEvent.setup();
    renderForm();
    await user.type(screen.getByLabelText('Amount ($)'), '10');
    await user.click(screen.getByRole('button', { name: 'Add' }));

    expect(await screen.findByText('Please choose a category')).toBeInTheDocument();
    expect(createTransaction).not.toHaveBeenCalled();
  });

  it('shows the toast when the API rejects', async () => {
    const user = userEvent.setup();
    vi.mocked(createTransaction).mockRejectedValue(new Error('boom'));

    renderForm();
    await user.selectOptions(screen.getByLabelText('Category'), 'c1');
    await user.type(screen.getByLabelText('Amount ($)'), '5');
    await user.click(screen.getByRole('button', { name: 'Add' }));

    await waitFor(() => expect(showErrorToast).toHaveBeenCalledWith('boom'));
  });
});
