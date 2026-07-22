import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

let accountsState: {
  accounts: unknown[];
  error: string | null;
  refresh: () => Promise<void>;
};
vi.mock('@/lib/accounts-context', () => ({ useAccounts: () => accountsState }));
vi.mock('@/lib/recurring', async (importActual) => ({
  ...(await importActual<typeof import('@/lib/recurring')>()),
  listRecurring: vi.fn(),
  deleteRecurring: vi.fn(),
}));
vi.mock('@/lib/categories', () => ({ listCategories: vi.fn() }));
vi.mock('@/lib/toast', () => ({
  showErrorToast: vi.fn(),
  showSuccessToast: vi.fn(),
}));
vi.mock('@/components/RecurringForm', async () => {
  const { useState } = await import('react');
  function RecurringFormStub(props: { recurring?: { _id: string } }) {
    const [mountedFor] = useState(props.recurring?._id ?? 'new');
    return <div>RecurringFormStub:mounted-for={mountedFor}</div>;
  }
  return { default: RecurringFormStub };
});

import { listRecurring, deleteRecurring } from '@/lib/recurring';
import { listCategories } from '@/lib/categories';
import { showSuccessToast, showErrorToast } from '@/lib/toast';
import RecurringPage from '@/app/recurring/page';
import type { Account, BudgetCategory, RecurringTransaction } from '@/lib/types';

/** ISO date-only string offset from today by whole UTC days. */
function dayOffset(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}

const accounts: Account[] = [
  { _id: 'a1', householdId: 'h', name: 'Checking', type: 'checking', balanceCents: 0, isArchived: false, createdAt: '', updatedAt: '' },
];
const categories: BudgetCategory[] = [
  { _id: 'c1', householdId: 'h', groupId: 'g', name: 'Utilities', isIncome: false, sortOrder: 0, isArchived: false, createdAt: '', updatedAt: '' },
  { _id: 'c2', householdId: 'h', groupId: 'g', name: 'Salary', isIncome: true, sortOrder: 0, isArchived: false, createdAt: '', updatedAt: '' },
];

const bill: RecurringTransaction = {
  _id: 'r1',
  householdId: 'h',
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
  createdAt: '',
  updatedAt: '',
};
const paycheck: RecurringTransaction = {
  ...bill,
  _id: 'r2',
  categoryId: 'c2',
  type: 'income',
  amountCents: 500000,
  payee: 'Employer',
  nextDate: dayOffset(10),
};

describe('RecurringPage', () => {
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

  it('renders schedules with signed amounts distinguishing bills from income', async () => {
    vi.mocked(listRecurring).mockResolvedValue([bill, paycheck]);
    render(<RecurringPage />);

    // Due-soon schedules also appear in the upcoming summary, so payees can
    // render in both sections.
    expect((await screen.findAllByText('Netflix')).length).toBeGreaterThan(0);
    // Expense is negative, income is positive — one of each is present.
    expect(screen.getAllByText('-$15.00').length).toBeGreaterThan(0);
    expect(screen.getAllByText('+$5,000.00').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Employer').length).toBeGreaterThan(0);
  });

  it('shows the empty state', async () => {
    vi.mocked(listRecurring).mockResolvedValue([]);
    render(<RecurringPage />);
    expect(await screen.findByText(/no schedules/i)).toBeInTheDocument();
  });

  it('surfaces an accounts-load error', async () => {
    accountsState = { accounts: [], error: 'boom', refresh: vi.fn() };
    vi.mocked(listRecurring).mockResolvedValue([]);
    render(<RecurringPage />);
    expect(await screen.findByText(/Couldn.t load accounts: boom/)).toBeInTheDocument();
  });

  it('shows an error (not empty state) when the list fetch fails', async () => {
    vi.mocked(listRecurring).mockRejectedValue(new Error('list fail'));
    render(<RecurringPage />);
    expect(await screen.findByText(/Couldn.t load schedules: list fail/)).toBeInTheDocument();
    expect(screen.queryByText(/no schedules/i)).toBeNull();
  });

  it('lists due-soon schedules in the upcoming section', async () => {
    const soon = { ...bill, _id: 'soon', payee: 'DueSoon', nextDate: dayOffset(3) };
    const far = { ...bill, _id: 'far', payee: 'FarAway', nextDate: dayOffset(90) };
    vi.mocked(listRecurring).mockResolvedValue([soon, far]);
    render(<RecurringPage />);

    const upcoming = await screen.findByRole('region', { name: /upcoming/i });
    expect(within(upcoming).getByText('DueSoon')).toBeInTheDocument();
    expect(within(upcoming).queryByText('FarAway')).toBeNull();
  });

  it('links each schedule to its materialized transactions', async () => {
    vi.mocked(listRecurring).mockResolvedValue([bill]);
    render(<RecurringPage />);
    await screen.findAllByText('Netflix');

    const link = screen.getByRole('link', { name: /history/i });
    expect(link).toHaveAttribute('href', '/transactions?recurringId=r1');
  });

  it('re-fetches when the type filter changes', async () => {
    vi.mocked(listRecurring).mockResolvedValue([bill]);
    const user = userEvent.setup();
    render(<RecurringPage />);
    await screen.findAllByText('Netflix');

    await user.selectOptions(screen.getByLabelText('Filter by type'), 'income');
    await waitFor(() =>
      expect(
        vi.mocked(listRecurring).mock.calls.some((c) => c[0]?.type === 'income'),
      ).toBe(true),
    );
  });

  it('remounts the form when switching Edit between schedules', async () => {
    vi.mocked(listRecurring).mockResolvedValue([bill, paycheck]);
    const user = userEvent.setup();
    render(<RecurringPage />);
    await screen.findAllByText('Netflix');

    await user.click(screen.getAllByRole('button', { name: 'Edit' })[0]);
    expect(screen.getByText(/RecurringFormStub:/)).toHaveTextContent('mounted-for=r1');
    await user.click(screen.getAllByRole('button', { name: 'Edit' })[1]);
    expect(screen.getByText(/RecurringFormStub:/)).toHaveTextContent('mounted-for=r2');
  });

  it('deletes a schedule through the confirm dialog', async () => {
    vi.mocked(listRecurring).mockResolvedValue([bill]);
    vi.mocked(deleteRecurring).mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<RecurringPage />);
    await screen.findAllByText('Netflix');

    await user.click(screen.getByRole('button', { name: 'Delete' }));
    await user.click(
      screen.getAllByRole('button', { name: 'Delete', hidden: true }).at(-1)!,
    );

    await waitFor(() => expect(deleteRecurring).toHaveBeenCalledWith('r1'));
    expect(showSuccessToast).toHaveBeenCalledWith('Schedule deleted');
  });

  it('disables the add button until an account exists', async () => {
    accountsState = { accounts: [], error: null, refresh: vi.fn() };
    vi.mocked(listRecurring).mockResolvedValue([]);
    render(<RecurringPage />);
    expect(await screen.findByRole('button', { name: /add (bill|schedule)/i })).toBeDisabled();
  });

  it('toasts when categories fail to load', async () => {
    vi.mocked(listRecurring).mockResolvedValue([]);
    vi.mocked(listCategories).mockRejectedValue(new Error('no cats'));
    render(<RecurringPage />);
    await waitFor(() => expect(showErrorToast).toHaveBeenCalledWith('no cats'));
  });
});
