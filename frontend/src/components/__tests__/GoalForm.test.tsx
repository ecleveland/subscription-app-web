import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('@/lib/goals', async (importOriginal) => {
  // accountFitsGoal runs for real. Only the network wrappers are mocked.
  const actual = await importOriginal<typeof import('@/lib/goals')>();
  return { ...actual, createGoal: vi.fn(), updateGoal: vi.fn() };
});
vi.mock('@/lib/toast', () => ({
  showErrorToast: vi.fn(),
  showSuccessToast: vi.fn(),
}));

const accountsState = {
  accounts: [] as Account[],
  loading: false,
  error: null as string | null,
  refresh: vi.fn(),
};
vi.mock('@/lib/accounts-context', () => ({
  useAccounts: () => accountsState,
}));

import { createGoal, updateGoal } from '@/lib/goals';
import { showErrorToast, showSuccessToast } from '@/lib/toast';
import GoalForm from '@/components/GoalForm';
import type { Account, AccountType, BudgetCategory, Goal } from '@/lib/types';

function account(_id: string, name: string, type: AccountType, isArchived = false): Account {
  return {
    _id,
    householdId: 'h',
    name,
    type,
    balanceCents: 0,
    isArchived,
    createdAt: '',
    updatedAt: '',
  };
}

const ledgerAccounts: Account[] = [
  account('a-chk', 'Checking', 'checking'),
  account('a-sav', 'Rainy day', 'savings'),
  account('a-cc', 'Visa', 'credit'),
  account('a-loan', 'Car loan', 'loan'),
  account('a-old', 'Old savings', 'savings', true),
];

const categories: BudgetCategory[] = [
  {
    _id: 'c1',
    householdId: 'h',
    groupId: 'g',
    name: 'Savings',
    isIncome: false,
    sortOrder: 0,
    isArchived: false,
    createdAt: '',
    updatedAt: '',
  },
  {
    _id: 'c2',
    householdId: 'h',
    groupId: 'g',
    name: 'Old bucket',
    isIncome: false,
    sortOrder: 1,
    isArchived: true,
    createdAt: '',
    updatedAt: '',
  },
];

const existing: Goal = {
  _id: 'g1',
  householdId: 'h',
  name: 'Car',
  type: 'savings',
  targetCents: 500000,
  currentCents: 1000,
  targetDate: '2027-06-01T00:00:00.000Z',
  categoryId: 'c1',
  linkedAccount: null,
  isArchived: false,
  createdAt: '',
  updatedAt: '',
};

const linked: Goal = {
  ...existing,
  linkedAccount: { accountId: 'a-sav', name: 'Rainy day' },
};

function accountOptions(): string[] {
  const select = screen.getByLabelText('Account');
  return Array.from(select.querySelectorAll('option')).map((o) => o.textContent ?? '');
}

describe('GoalForm', () => {
  beforeEach(() => {
    accountsState.accounts = ledgerAccounts;
    accountsState.loading = false;
    accountsState.error = null;
  });
  afterEach(() => vi.clearAllMocks());

  it('creates a goal in cents and omits empty optional fields', async () => {
    const user = userEvent.setup();
    vi.mocked(createGoal).mockResolvedValue(existing);
    const onSaved = vi.fn();
    render(<GoalForm categories={categories} onSaved={onSaved} onCancel={vi.fn()} />);

    await user.type(screen.getByLabelText('Name'), 'Pay off card');
    await user.selectOptions(screen.getByLabelText('Type'), 'debt');
    await user.type(screen.getByLabelText('Target ($)'), '1200.50');
    await user.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() =>
      expect(createGoal).toHaveBeenCalledWith({
        name: 'Pay off card',
        type: 'debt',
        targetCents: 120050,
      }),
    );
    expect(showSuccessToast).toHaveBeenCalledWith('Goal created');
    expect(onSaved).toHaveBeenCalledWith(existing);
  });

  it('includes a target date and category on create when set', async () => {
    const user = userEvent.setup();
    vi.mocked(createGoal).mockResolvedValue(existing);
    render(<GoalForm categories={categories} onSaved={vi.fn()} onCancel={vi.fn()} />);

    await user.type(screen.getByLabelText('Name'), 'Car');
    await user.type(screen.getByLabelText('Target ($)'), '5000');
    await user.type(screen.getByLabelText('Target date'), '2027-06-01');
    await user.selectOptions(screen.getByLabelText('Category'), 'c1');
    await user.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() =>
      expect(createGoal).toHaveBeenCalledWith({
        name: 'Car',
        type: 'savings',
        targetCents: 500000,
        targetDate: '2027-06-01',
        categoryId: 'c1',
      }),
    );
  });

  it('hides archived categories from the picker', () => {
    render(<GoalForm categories={categories} onSaved={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByRole('option', { name: 'None' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Old bucket' })).toBeNull();
  });

  it('rejects a zero target inline without calling the API', async () => {
    const user = userEvent.setup();
    render(<GoalForm categories={categories} onSaved={vi.fn()} onCancel={vi.fn()} />);
    await user.type(screen.getByLabelText('Name'), 'Car');
    await user.type(screen.getByLabelText('Target ($)'), '0');
    await user.click(screen.getByRole('button', { name: 'Create' }));
    expect(screen.getByText('Target must be greater than $0')).toBeInTheDocument();
    expect(createGoal).not.toHaveBeenCalled();
  });

  it.each(['10.505', '1e3'])(
    'rejects an unparseable target %s with the decimals message',
    async (value) => {
      const user = userEvent.setup();
      render(<GoalForm categories={categories} onSaved={vi.fn()} onCancel={vi.fn()} />);
      await user.type(screen.getByLabelText('Name'), 'Car');
      await user.type(screen.getByLabelText('Target ($)'), value);
      await user.click(screen.getByRole('button', { name: 'Create' }));
      expect(
        screen.getByText('Target must be a dollar amount with at most 2 decimals'),
      ).toBeInTheDocument();
      expect(screen.queryByText('Target must be greater than $0')).toBeNull();
      expect(createGoal).not.toHaveBeenCalled();
    },
  );

  it('shows a rejected save inline and as a toast', async () => {
    const user = userEvent.setup();
    vi.mocked(createGoal).mockRejectedValue(new Error('Category not found'));
    const onSaved = vi.fn();
    render(<GoalForm categories={categories} onSaved={onSaved} onCancel={vi.fn()} />);
    await user.type(screen.getByLabelText('Name'), 'Car');
    await user.type(screen.getByLabelText('Target ($)'), '10');
    await user.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => expect(showErrorToast).toHaveBeenCalledWith('Category not found'));
    expect(screen.getByText('Category not found')).toBeInTheDocument();
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('prefills in edit mode and sends null to clear date and category', async () => {
    const user = userEvent.setup();
    const updated = { ...existing, targetDate: null, categoryId: null };
    vi.mocked(updateGoal).mockResolvedValue(updated);
    const onSaved = vi.fn();
    render(
      <GoalForm goal={existing} categories={categories} onSaved={onSaved} onCancel={vi.fn()} />,
    );

    expect(screen.getByLabelText('Name')).toHaveValue('Car');
    expect(screen.getByLabelText('Target ($)')).toHaveValue('5000');
    expect(screen.getByLabelText('Target date')).toHaveValue('2027-06-01');
    expect(screen.getByLabelText('Category')).toHaveValue('c1');

    await user.clear(screen.getByLabelText('Target date'));
    await user.selectOptions(screen.getByLabelText('Category'), '');
    await user.click(screen.getByRole('button', { name: 'Update' }));

    await waitFor(() =>
      expect(updateGoal).toHaveBeenCalledWith('g1', {
        targetDate: null,
        categoryId: null,
      }),
    );
    expect(showSuccessToast).toHaveBeenCalledWith('Goal updated');
    expect(onSaved).toHaveBeenCalledWith(updated);
  });

  it('shows a rejected update inline and as a toast without calling onSaved', async () => {
    const user = userEvent.setup();
    vi.mocked(updateGoal).mockRejectedValue(new Error('Goal not found'));
    const onSaved = vi.fn();
    render(
      <GoalForm goal={existing} categories={categories} onSaved={onSaved} onCancel={vi.fn()} />,
    );
    await user.clear(screen.getByLabelText('Name'));
    await user.type(screen.getByLabelText('Name'), 'Truck');
    await user.click(screen.getByRole('button', { name: 'Update' }));

    await waitFor(() => expect(showErrorToast).toHaveBeenCalledWith('Goal not found'));
    expect(screen.getByText('Goal not found')).toBeInTheDocument();
    expect(onSaved).not.toHaveBeenCalled();
    expect(showSuccessToast).not.toHaveBeenCalled();
  });

  it('hints when categories are unavailable and keeps the edit placeholder', () => {
    render(
      <GoalForm
        goal={existing}
        categories={[]}
        categoriesUnavailable
        onSaved={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(
      screen.getByText("Couldn't load categories. You can set one later."),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Category')).toHaveValue('c1');
    expect(
      screen.getByRole('option', { name: 'Current category (unavailable)' }),
    ).toBeDisabled();
  });

  it('sends only changed fields in edit mode', async () => {
    const user = userEvent.setup();
    vi.mocked(updateGoal).mockResolvedValue(existing);
    render(
      <GoalForm goal={existing} categories={categories} onSaved={vi.fn()} onCancel={vi.fn()} />,
    );
    await user.clear(screen.getByLabelText('Name'));
    await user.type(screen.getByLabelText('Name'), 'New car');
    await user.clear(screen.getByLabelText('Target ($)'));
    await user.type(screen.getByLabelText('Target ($)'), '6000');
    await user.click(screen.getByRole('button', { name: 'Update' }));

    await waitFor(() =>
      expect(updateGoal).toHaveBeenCalledWith('g1', {
        name: 'New car',
        targetCents: 600000,
      }),
    );
  });

  it('keeps an archived category the goal already uses selectable', () => {
    render(
      <GoalForm
        goal={{ ...existing, categoryId: 'c2' }}
        categories={categories}
        onSaved={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByLabelText('Category')).toHaveValue('c2');
  });

  it('shows a missing current category as unavailable and lets None clear it', async () => {
    const user = userEvent.setup();
    vi.mocked(updateGoal).mockResolvedValue({ ...existing, categoryId: null });
    render(
      <GoalForm
        goal={{ ...existing, categoryId: 'gone' }}
        categories={categories}
        onSaved={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    const select = screen.getByLabelText('Category');
    expect(select).toHaveValue('gone');
    expect(
      screen.getByRole('option', { name: 'Current category (unavailable)' }),
    ).toBeDisabled();

    await user.selectOptions(select, '');
    await user.click(screen.getByRole('button', { name: 'Update' }));

    await waitFor(() =>
      expect(updateGoal).toHaveBeenCalledWith('g1', { categoryId: null }),
    );
  });

  describe('account link', () => {
    it('lists only unarchived accounts that fit the goal type', async () => {
      const user = userEvent.setup();
      render(<GoalForm categories={categories} onSaved={vi.fn()} onCancel={vi.fn()} />);
      expect(accountOptions()).toEqual(['None (manual)', 'Checking', 'Rainy day']);

      await user.selectOptions(screen.getByLabelText('Type'), 'debt');
      expect(accountOptions()).toEqual(['None (manual)', 'Visa', 'Car loan']);
    });

    it('sends accountId on create when an account is picked', async () => {
      const user = userEvent.setup();
      vi.mocked(createGoal).mockResolvedValue(linked);
      render(<GoalForm categories={categories} onSaved={vi.fn()} onCancel={vi.fn()} />);
      await user.type(screen.getByLabelText('Name'), 'Rainy day fund');
      await user.type(screen.getByLabelText('Target ($)'), '100');
      await user.selectOptions(screen.getByLabelText('Account'), 'a-sav');
      await user.click(screen.getByRole('button', { name: 'Create' }));

      await waitFor(() =>
        expect(createGoal).toHaveBeenCalledWith({
          name: 'Rainy day fund',
          type: 'savings',
          targetCents: 10000,
          accountId: 'a-sav',
        }),
      );
    });

    it('omits accountId on create when None is picked', async () => {
      const user = userEvent.setup();
      vi.mocked(createGoal).mockResolvedValue(existing);
      render(<GoalForm categories={categories} onSaved={vi.fn()} onCancel={vi.fn()} />);
      await user.type(screen.getByLabelText('Name'), 'Car');
      await user.type(screen.getByLabelText('Target ($)'), '100');
      await user.selectOptions(screen.getByLabelText('Account'), 'a-chk');
      await user.selectOptions(screen.getByLabelText('Account'), '');
      await user.click(screen.getByRole('button', { name: 'Create' }));

      await waitFor(() => expect(createGoal).toHaveBeenCalled());
      expect(vi.mocked(createGoal).mock.calls[0][0]).not.toHaveProperty('accountId');
    });

    it('prefills the linked account and sends null when switched to None', async () => {
      const user = userEvent.setup();
      vi.mocked(updateGoal).mockResolvedValue({ ...linked, linkedAccount: null });
      render(
        <GoalForm goal={linked} categories={categories} onSaved={vi.fn()} onCancel={vi.fn()} />,
      );
      expect(screen.getByLabelText('Account')).toHaveValue('a-sav');

      await user.selectOptions(screen.getByLabelText('Account'), '');
      await user.click(screen.getByRole('button', { name: 'Update' }));

      await waitFor(() =>
        expect(updateGoal).toHaveBeenCalledWith('g1', { accountId: null }),
      );
    });

    it('omits accountId on edit when the link is unchanged', async () => {
      const user = userEvent.setup();
      vi.mocked(updateGoal).mockResolvedValue(linked);
      render(
        <GoalForm goal={linked} categories={categories} onSaved={vi.fn()} onCancel={vi.fn()} />,
      );
      await user.clear(screen.getByLabelText('Name'));
      await user.type(screen.getByLabelText('Name'), 'Truck');
      await user.click(screen.getByRole('button', { name: 'Update' }));

      await waitFor(() =>
        expect(updateGoal).toHaveBeenCalledWith('g1', { name: 'Truck' }),
      );
    });

    it('sends a new accountId on edit when the link changes', async () => {
      const user = userEvent.setup();
      vi.mocked(updateGoal).mockResolvedValue(linked);
      render(
        <GoalForm goal={linked} categories={categories} onSaved={vi.fn()} onCancel={vi.fn()} />,
      );
      await user.selectOptions(screen.getByLabelText('Account'), 'a-chk');
      await user.click(screen.getByRole('button', { name: 'Update' }));

      await waitFor(() =>
        expect(updateGoal).toHaveBeenCalledWith('g1', { accountId: 'a-chk' }),
      );
    });

    it('clears a checking selection when the type switches to debt', async () => {
      const user = userEvent.setup();
      render(<GoalForm categories={categories} onSaved={vi.fn()} onCancel={vi.fn()} />);
      await user.selectOptions(screen.getByLabelText('Account'), 'a-chk');
      await user.selectOptions(screen.getByLabelText('Type'), 'debt');
      expect(screen.getByLabelText('Account')).toHaveValue('');
    });

    it('unlinks on edit when the type switch drops the account', async () => {
      const user = userEvent.setup();
      vi.mocked(updateGoal).mockResolvedValue(existing);
      render(
        <GoalForm goal={linked} categories={categories} onSaved={vi.fn()} onCancel={vi.fn()} />,
      );
      await user.selectOptions(screen.getByLabelText('Type'), 'debt');
      await user.click(screen.getByRole('button', { name: 'Update' }));

      await waitFor(() =>
        expect(updateGoal).toHaveBeenCalledWith('g1', { type: 'debt', accountId: null }),
      );
    });

    it('unlinks on a type switch when the linked account is not in the list', async () => {
      const user = userEvent.setup();
      vi.mocked(updateGoal).mockResolvedValue(existing);
      render(
        <GoalForm
          goal={{ ...existing, linkedAccount: { accountId: 'gone', name: 'Closed' } }}
          categories={categories}
          onSaved={vi.fn()}
          onCancel={vi.fn()}
        />,
      );
      await user.selectOptions(screen.getByLabelText('Type'), 'debt');
      await user.click(screen.getByRole('button', { name: 'Update' }));

      await waitFor(() =>
        expect(updateGoal).toHaveBeenCalledWith('g1', { type: 'debt', accountId: null }),
      );
    });

    it('keeps the link on a type switch when accounts failed to load', async () => {
      const user = userEvent.setup();
      accountsState.accounts = [];
      accountsState.error = 'Network down';
      vi.mocked(updateGoal).mockResolvedValue(linked);
      render(
        <GoalForm goal={linked} categories={categories} onSaved={vi.fn()} onCancel={vi.fn()} />,
      );
      await user.selectOptions(screen.getByLabelText('Type'), 'debt');
      await user.click(screen.getByRole('button', { name: 'Update' }));

      await waitFor(() =>
        expect(updateGoal).toHaveBeenCalledWith('g1', { type: 'debt' }),
      );
    });

    it('keeps the link on a type switch while accounts are still loading', async () => {
      const user = userEvent.setup();
      accountsState.accounts = [];
      accountsState.loading = true;
      vi.mocked(updateGoal).mockResolvedValue(linked);
      render(
        <GoalForm goal={linked} categories={categories} onSaved={vi.fn()} onCancel={vi.fn()} />,
      );
      await user.selectOptions(screen.getByLabelText('Type'), 'debt');
      await user.click(screen.getByRole('button', { name: 'Update' }));

      await waitFor(() =>
        expect(updateGoal).toHaveBeenCalledWith('g1', { type: 'debt' }),
      );
    });

    it('shows a disabled loading option while accounts load', () => {
      accountsState.loading = true;
      accountsState.accounts = [];
      render(
        <GoalForm goal={linked} categories={categories} onSaved={vi.fn()} onCancel={vi.fn()} />,
      );
      const select = screen.getByLabelText('Account');
      expect(select).toBeDisabled();
      expect(select).toHaveValue('a-sav');
      expect(screen.getByRole('option', { name: 'Loading accounts...' })).toBeInTheDocument();
    });

    it('keeps an archived linked account as a disabled placeholder', () => {
      render(
        <GoalForm
          goal={{ ...existing, linkedAccount: { accountId: 'a-old', name: 'Old savings' } }}
          categories={categories}
          onSaved={vi.fn()}
          onCancel={vi.fn()}
        />,
      );
      expect(screen.getByLabelText('Account')).toHaveValue('a-old');
      expect(
        screen.getByRole('option', { name: 'Old savings (archived or unavailable)' }),
      ).toBeDisabled();
      expect(screen.queryByRole('option', { name: 'Old savings' })).toBeNull();
    });

    it('keeps a missing linked account as a placeholder that None can clear', async () => {
      const user = userEvent.setup();
      vi.mocked(updateGoal).mockResolvedValue(existing);
      render(
        <GoalForm
          goal={{ ...existing, linkedAccount: { accountId: 'gone', name: 'Closed' } }}
          categories={categories}
          onSaved={vi.fn()}
          onCancel={vi.fn()}
        />,
      );
      const select = screen.getByLabelText('Account');
      expect(select).toHaveValue('gone');
      expect(
        screen.getByRole('option', { name: 'Closed (archived or unavailable)' }),
      ).toBeDisabled();

      await user.selectOptions(select, '');
      await user.click(screen.getByRole('button', { name: 'Update' }));
      await waitFor(() =>
        expect(updateGoal).toHaveBeenCalledWith('g1', { accountId: null }),
      );
    });

    it('hints when accounts failed to load and keeps the linked placeholder', () => {
      accountsState.accounts = [];
      accountsState.error = 'Network down';
      render(
        <GoalForm goal={linked} categories={categories} onSaved={vi.fn()} onCancel={vi.fn()} />,
      );
      expect(
        screen.getByText("Couldn't load accounts. You can link one later."),
      ).toBeInTheDocument();
      expect(screen.getByLabelText('Account')).toHaveValue('a-sav');
      expect(
        screen.getByRole('option', { name: 'Rainy day (could not load accounts)' }),
      ).toBeDisabled();
    });

    it('shows a rejected linked create as a toast', async () => {
      const user = userEvent.setup();
      vi.mocked(createGoal).mockRejectedValue(new Error('Account does not fit goal'));
      render(<GoalForm categories={categories} onSaved={vi.fn()} onCancel={vi.fn()} />);
      await user.type(screen.getByLabelText('Name'), 'Car');
      await user.type(screen.getByLabelText('Target ($)'), '100');
      await user.selectOptions(screen.getByLabelText('Account'), 'a-sav');
      await user.click(screen.getByRole('button', { name: 'Create' }));

      await waitFor(() =>
        expect(showErrorToast).toHaveBeenCalledWith('Account does not fit goal'),
      );
    });
  });

  it('calls onCancel', async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    render(<GoalForm categories={categories} onSaved={vi.fn()} onCancel={onCancel} />);
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalled();
  });
});
