import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('@/lib/transactions', () => ({
  createTransaction: vi.fn(),
  updateTransaction: vi.fn(),
}));
vi.mock('@/lib/labels', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/labels')>()),
  createLabel: vi.fn(),
}));
vi.mock('@/lib/toast', () => ({
  showErrorToast: vi.fn(),
  showSuccessToast: vi.fn(),
}));

import { createTransaction, updateTransaction } from '@/lib/transactions';
import { createLabel } from '@/lib/labels';
import { showErrorToast } from '@/lib/toast';
import TransactionForm from '@/components/TransactionForm';
import type { Account, BudgetCategory, Label, Transaction } from '@/lib/types';

const accounts: Account[] = [
  { _id: 'a1', householdId: 'h', name: 'Checking', type: 'checking', balanceCents: 0, isArchived: false, createdAt: '', updatedAt: '' },
  { _id: 'a2', householdId: 'h', name: 'Savings', type: 'savings', balanceCents: 0, isArchived: false, createdAt: '', updatedAt: '' },
];
const categories: BudgetCategory[] = [
  { _id: 'c1', householdId: 'h', groupId: 'g', name: 'Groceries', isIncome: false, sortOrder: 0, isArchived: false, createdAt: '', updatedAt: '' },
  { _id: 'c2', householdId: 'h', groupId: 'g', name: 'Paycheck', isIncome: true, sortOrder: 0, isArchived: false, createdAt: '', updatedAt: '' },
];
const bizLabel: Label = {
  _id: 'l1',
  householdId: 'h',
  name: 'Etsy shop',
  color: '#2f8a93',
  isArchived: false,
  createdAt: '',
  updatedAt: '',
};

const labeledTxn: Transaction = {
  _id: 't1',
  householdId: 'h',
  accountId: 'a1',
  categoryId: 'c1',
  type: 'expense',
  amountCents: 4200,
  date: '2026-06-01T00:00:00.000Z',
  payee: 'Supplies',
  cleared: false,
  labelId: 'l1',
  createdAt: '',
  updatedAt: '',
};

function renderForm(extra = {}) {
  return render(
    <TransactionForm
      accounts={accounts}
      categories={categories}
      labels={[]}
      onLabelCreated={vi.fn()}
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

  it('prefills from a transaction and updates (amount from cents)', async () => {
    const user = userEvent.setup();
    vi.mocked(updateTransaction).mockResolvedValue({} as never);
    const txn: Transaction = {
      _id: 't1',
      householdId: 'h',
      accountId: 'a1',
      categoryId: 'c1',
      type: 'expense',
      amountCents: 4200,
      date: '2026-06-01T00:00:00.000Z',
      payee: 'Old Payee',
      cleared: false,
      createdAt: '',
      updatedAt: '',
    };

    renderForm({ transaction: txn });
    expect(screen.getByText('Edit transaction')).toBeInTheDocument();
    expect(screen.getByLabelText('Amount ($)')).toHaveValue('42.00');
    expect(screen.getByLabelText('Date')).toHaveValue('2026-06-01');

    // Clear the payee and change the amount.
    await user.clear(screen.getByLabelText('Payee'));
    await user.clear(screen.getByLabelText('Amount ($)'));
    await user.type(screen.getByLabelText('Amount ($)'), '50.00');
    await user.click(screen.getByRole('button', { name: 'Update' }));

    await waitFor(() =>
      expect(updateTransaction).toHaveBeenCalledWith(
        't1',
        // empty string clears the payee; amount converted to cents
        expect.objectContaining({ amountCents: 5000, payee: '' }),
      ),
    );
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

  describe('label', () => {
    it('hides the label picker for a transfer', async () => {
      const user = userEvent.setup();
      renderForm({ labels: [bizLabel] });
      expect(screen.getByRole('radiogroup', { name: 'Label' })).toBeInTheDocument();

      await user.selectOptions(screen.getByLabelText('Type'), 'transfer');

      expect(screen.queryByRole('radiogroup', { name: 'Label' })).toBeNull();
      expect(screen.queryByLabelText('Label')).toBeNull();
      expect(screen.queryByRole('button', { name: 'Add a label' })).toBeNull();
    });

    it('omits labelId on a transfer even when a label was picked first', async () => {
      const user = userEvent.setup();
      vi.mocked(createTransaction).mockResolvedValue({} as never);
      renderForm({ labels: [bizLabel] });

      await user.click(screen.getByRole('radio', { name: 'Etsy shop' }));
      await user.selectOptions(screen.getByLabelText('Type'), 'transfer');
      await user.selectOptions(screen.getByLabelText('To account'), 'a2');
      await user.type(screen.getByLabelText('Amount ($)'), '100');
      await user.click(screen.getByRole('button', { name: 'Add' }));

      await waitFor(() => expect(createTransaction).toHaveBeenCalledTimes(1));
      expect(vi.mocked(createTransaction).mock.calls[0][0]).not.toHaveProperty('labelId');
    });

    it('sends the picked labelId on create', async () => {
      const user = userEvent.setup();
      vi.mocked(createTransaction).mockResolvedValue({} as never);
      renderForm({ labels: [bizLabel] });

      await user.selectOptions(screen.getByLabelText('Category'), 'c1');
      await user.type(screen.getByLabelText('Amount ($)'), '12');
      await user.click(screen.getByRole('radio', { name: 'Etsy shop' }));
      await user.click(screen.getByRole('button', { name: 'Add' }));

      await waitFor(() =>
        expect(createTransaction).toHaveBeenCalledWith(
          expect.objectContaining({ labelId: 'l1' }),
        ),
      );
    });

    it('omits labelId on create when Personal is picked', async () => {
      const user = userEvent.setup();
      vi.mocked(createTransaction).mockResolvedValue({} as never);
      renderForm({ labels: [bizLabel] });

      await user.selectOptions(screen.getByLabelText('Category'), 'c1');
      await user.type(screen.getByLabelText('Amount ($)'), '12');
      expect(screen.getByRole('radio', { name: 'Personal' })).toHaveAttribute(
        'aria-checked',
        'true',
      );
      await user.click(screen.getByRole('button', { name: 'Add' }));

      await waitFor(() => expect(createTransaction).toHaveBeenCalledTimes(1));
      expect(vi.mocked(createTransaction).mock.calls[0][0]).not.toHaveProperty('labelId');
    });

    it('sends labelId null when an edit switches a labeled transaction to Personal', async () => {
      const user = userEvent.setup();
      vi.mocked(updateTransaction).mockResolvedValue({} as never);
      renderForm({ labels: [bizLabel], transaction: labeledTxn });

      expect(screen.getByRole('radio', { name: 'Etsy shop' })).toHaveAttribute(
        'aria-checked',
        'true',
      );
      await user.click(screen.getByRole('radio', { name: 'Personal' }));
      await user.click(screen.getByRole('button', { name: 'Update' }));

      await waitFor(() => expect(updateTransaction).toHaveBeenCalledTimes(1));
      expect(vi.mocked(updateTransaction).mock.calls[0][1].labelId).toBeNull();
    });

    it('reports a label added inline and submits with its id', async () => {
      const user = userEvent.setup();
      const created: Label = { ...bizLabel, _id: 'l-new', name: 'Consulting' };
      vi.mocked(createLabel).mockResolvedValue(created);
      vi.mocked(createTransaction).mockResolvedValue({} as never);
      const onLabelCreated = vi.fn();
      renderForm({ onLabelCreated });

      await user.selectOptions(screen.getByLabelText('Category'), 'c1');
      await user.type(screen.getByLabelText('Amount ($)'), '12');
      await user.click(screen.getByRole('button', { name: 'Add a label' }));
      const nameInput = screen.getByLabelText('New label name');
      await user.type(nameInput, 'Consulting');
      await user.click(
        within(nameInput.parentElement!).getByRole('button', { name: 'Add' }),
      );

      await waitFor(() => expect(onLabelCreated).toHaveBeenCalledWith(created));
      await user.click(screen.getByRole('button', { name: 'Add' }));

      await waitFor(() =>
        expect(createTransaction).toHaveBeenCalledWith(
          expect.objectContaining({ labelId: 'l-new' }),
        ),
      );
    });
  });
});
