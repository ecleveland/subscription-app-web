import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('@/lib/recurring', () => ({
  createRecurring: vi.fn(),
  updateRecurring: vi.fn(),
}));
vi.mock('@/lib/toast', () => ({
  showErrorToast: vi.fn(),
  showSuccessToast: vi.fn(),
}));

import RecurringForm from '../RecurringForm';
import { createRecurring, updateRecurring } from '@/lib/recurring';
import { showErrorToast, showSuccessToast } from '@/lib/toast';
import type { Account, BudgetCategory, RecurringTransaction } from '@/lib/types';

const accounts: Account[] = [
  {
    _id: 'acc1',
    householdId: 'h1',
    name: 'Checking',
    type: 'checking',
    balanceCents: 100000,
    isArchived: false,
    createdAt: '',
    updatedAt: '',
  },
];

const categories: BudgetCategory[] = [
  {
    _id: 'catExp',
    householdId: 'h1',
    groupId: 'g1',
    name: 'Utilities',
    isIncome: false,
    sortOrder: 0,
    isArchived: false,
    createdAt: '',
    updatedAt: '',
  },
  {
    _id: 'catInc',
    householdId: 'h1',
    groupId: 'g2',
    name: 'Salary',
    isIncome: true,
    sortOrder: 0,
    isArchived: false,
    createdAt: '',
    updatedAt: '',
  },
];

const existing: RecurringTransaction = {
  _id: 'r1',
  householdId: 'h1',
  accountId: 'acc1',
  categoryId: 'catExp',
  type: 'expense',
  amountCents: 1500,
  payee: 'Netflix',
  cadence: 'monthly',
  nextDate: '2026-08-01',
  reminderDaysBefore: 3,
  isActive: true,
  isSubscription: false,
  createdAt: '',
  updatedAt: '',
};

function renderForm(props: Partial<React.ComponentProps<typeof RecurringForm>> = {}) {
  const onSaved = vi.fn();
  const onCancel = vi.fn();
  render(
    <RecurringForm
      accounts={accounts}
      categories={categories}
      onSaved={onSaved}
      onCancel={onCancel}
      {...props}
    />,
  );
  return { onSaved, onCancel };
}

describe('RecurringForm', () => {
  afterEach(() => vi.clearAllMocks());

  it('creates a schedule, converting dollars to integer cents at the boundary', async () => {
    const user = userEvent.setup();
    vi.mocked(createRecurring).mockResolvedValue(existing);
    const { onSaved } = renderForm();

    await user.type(screen.getByLabelText(/payee/i), 'Netflix');
    await user.type(screen.getByLabelText(/amount/i), '9.99');
    await user.type(screen.getByLabelText(/next date/i), '2026-08-01');
    await user.selectOptions(screen.getByLabelText('Category'), 'catExp');

    await user.click(screen.getByRole('button', { name: /add|create|save/i }));

    await waitFor(() => expect(createRecurring).toHaveBeenCalledTimes(1));
    const body = vi.mocked(createRecurring).mock.calls[0][0];
    expect(body).toMatchObject({
      accountId: 'acc1',
      categoryId: 'catExp',
      type: 'expense',
      amountCents: 999,
      payee: 'Netflix',
      cadence: 'monthly',
      nextDate: '2026-08-01',
      reminderDaysBefore: 3,
    });
    expect(showSuccessToast).toHaveBeenCalled();
    expect(onSaved).toHaveBeenCalled();
  });

  it('rejects a non-positive amount without calling the API', async () => {
    const user = userEvent.setup();
    renderForm();
    await user.type(screen.getByLabelText(/payee/i), 'Netflix');
    await user.type(screen.getByLabelText(/amount/i), '0');
    await user.type(screen.getByLabelText(/next date/i), '2026-08-01');
    await user.click(screen.getByRole('button', { name: /add|create|save/i }));

    expect(await screen.findByText(/amount must be a positive number/i)).toBeInTheDocument();
    expect(createRecurring).not.toHaveBeenCalled();
  });

  it('rejects an end date before the next date', async () => {
    const user = userEvent.setup();
    renderForm();
    await user.type(screen.getByLabelText(/payee/i), 'Netflix');
    await user.type(screen.getByLabelText(/amount/i), '9.99');
    await user.type(screen.getByLabelText(/next date/i), '2026-08-01');
    await user.selectOptions(screen.getByLabelText('Category'), 'catExp');
    await user.click(screen.getByLabelText('Has end date'));
    await user.type(screen.getByLabelText('End date'), '2026-07-01');
    await user.click(screen.getByRole('button', { name: /add|create|save/i }));

    expect(
      await screen.findByText(/end date must be on or after the next date/i),
    ).toBeInTheDocument();
    expect(createRecurring).not.toHaveBeenCalled();
  });

  it('offers the subscription flag for expenses but hides it for income', async () => {
    const user = userEvent.setup();
    renderForm();
    // Expense (default): the flag is available.
    expect(screen.getByLabelText(/subscription/i)).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText(/^type$/i), 'income');
    expect(screen.queryByLabelText(/subscription/i)).not.toBeInTheDocument();
  });

  it('clears the chosen category when the type changes, preventing a mismatch', async () => {
    const user = userEvent.setup();
    renderForm();
    await user.type(screen.getByLabelText(/payee/i), 'Paycheck');
    await user.type(screen.getByLabelText(/amount/i), '9.99');
    await user.type(screen.getByLabelText(/next date/i), '2026-08-01');
    // Pick an expense category, then switch the type to income.
    await user.selectOptions(screen.getByLabelText('Category'), 'catExp');
    await user.selectOptions(screen.getByLabelText(/^type$/i), 'income');

    // The expense category must not carry over to an income schedule.
    await user.click(screen.getByRole('button', { name: /add|create|save/i }));
    expect(await screen.findByText(/please choose a category/i)).toBeInTheDocument();
    expect(createRecurring).not.toHaveBeenCalled();
  });

  it('prefills fields in edit mode and PATCHes on save', async () => {
    const user = userEvent.setup();
    vi.mocked(updateRecurring).mockResolvedValue(existing);
    const { onSaved } = renderForm({ recurring: existing });

    expect(screen.getByLabelText(/payee/i)).toHaveValue('Netflix');
    expect(screen.getByLabelText(/amount/i)).toHaveValue('15.00');

    await user.click(screen.getByRole('button', { name: /update|save/i }));

    await waitFor(() => expect(updateRecurring).toHaveBeenCalledTimes(1));
    expect(vi.mocked(updateRecurring).mock.calls[0][0]).toBe('r1');
    expect(showSuccessToast).toHaveBeenCalled();
    expect(onSaved).toHaveBeenCalled();
  });

  it('surfaces an API error via toast and inline message', async () => {
    const user = userEvent.setup();
    vi.mocked(createRecurring).mockRejectedValue(new Error('Server exploded'));
    renderForm();
    await user.type(screen.getByLabelText(/payee/i), 'Netflix');
    await user.type(screen.getByLabelText(/amount/i), '9.99');
    await user.type(screen.getByLabelText(/next date/i), '2026-08-01');
    await user.selectOptions(screen.getByLabelText('Category'), 'catExp');
    await user.click(screen.getByRole('button', { name: /add|create|save/i }));

    expect(await screen.findByText(/server exploded/i)).toBeInTheDocument();
    expect(showErrorToast).toHaveBeenCalledWith('Server exploded');
  });
});
