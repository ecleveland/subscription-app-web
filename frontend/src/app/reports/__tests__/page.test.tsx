import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';

vi.mock('@/lib/reports', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/reports')>();
  return {
    ...actual,
    defaultRange: vi.fn(actual.defaultRange),
    getCashFlow: vi.fn(),
  getSpending: vi.fn(),
    getNetWorth: vi.fn(),
  };
});
let accountsState: { accounts: unknown[] };
vi.mock('@/lib/accounts-context', () => ({ useAccounts: () => accountsState }));
vi.mock('@/lib/api', () => ({ apiFetch: vi.fn() }));
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ isAuthenticated: true }),
}));
vi.mock('@/lib/toast', () => ({
  showErrorToast: vi.fn(),
  showSuccessToast: vi.fn(),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/reports',
  permanentRedirect: vi.fn(),
}));

import {
  getCashFlow,
  getSpending,
  getNetWorth,
  defaultRange,
  MAX_REPORT_MONTHS,
  type CashFlowReport,
  type NetWorthReport,
  type SpendingReport,
} from '@/lib/reports';
import { shiftMonth } from '@/lib/budget';
import { apiFetch } from '@/lib/api';
import { showErrorToast } from '@/lib/toast';
import ReportsPage from '@/app/reports/page';
import type { PaginatedResponse, Subscription } from '@/lib/types';

// Recharts uses ResizeObserver internally
global.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

const currentMonth = new Date().toISOString().slice(0, 7);

const cashFlow: CashFlowReport = {
  months: [
    { month: '2026-09', incomeCents: 500000, expenseCents: 320000, netCents: 180000 },
    { month: '2026-10', incomeCents: 0, expenseCents: 0, netCents: 0 },
  ],
};

const spending: SpendingReport = {
  month: currentMonth,
  categories: [
    {
      categoryId: 'c1',
      categoryName: 'Groceries',
      groupId: 'g1',
      groupName: 'Food',
      actualCents: 45000,
      plannedCents: 50000,
    },
  ],
  uncategorizedCents: 0,
  totalCents: 45000,
};

const netWorth: NetWorthReport = {
  months: [
    {
      month: '2026-10',
      assetsCents: 1200000,
      liabilitiesCents: -200000,
      netWorthCents: 1000000,
      accounts: [
        { accountId: 'a1', name: 'Checking', type: 'checking', balanceCents: 1200000 },
      ],
    },
  ],
};

const subscriptions: PaginatedResponse<Subscription> = {
  data: [
    {
      _id: 's1',
      userId: 'u1',
      name: 'Netflix',
      cost: 15,
      billingCycle: 'monthly',
      nextBillingDate: '2026-11-01',
      category: 'Streaming',
      isActive: true,
      createdAt: '2026-01-01',
      updatedAt: '2026-01-01',
    },
  ],
  meta: { total: 1, page: 1, limit: 0, totalPages: 1 },
} as PaginatedResponse<Subscription>;

function section(name: string): HTMLElement {
  return screen.getByRole('region', { name });
}

beforeEach(() => {
  vi.mocked(getCashFlow).mockReset().mockResolvedValue(cashFlow);
  vi.mocked(getSpending).mockReset().mockResolvedValue(spending);
  vi.mocked(getNetWorth).mockReset().mockResolvedValue(netWorth);
  vi.mocked(apiFetch).mockReset().mockResolvedValue(subscriptions);
  vi.mocked(showErrorToast).mockReset();
  vi.mocked(defaultRange).mockClear();
  accountsState = { accounts: [{ _id: 'a1', name: 'Checking' }] };
});

describe('ReportsPage', () => {
  it('renders all four report sections from their data', async () => {
    render(<ReportsPage />);

    expect(
      screen.getByRole('heading', { level: 1, name: 'Reports' }),
    ).toBeInTheDocument();

    const { from, to } = defaultRange();
    await waitFor(() =>
      expect(within(section('Cash flow')).getByText('Sep 2026')).toBeInTheDocument(),
    );
    expect(getCashFlow).toHaveBeenCalledWith(from, to);
    expect(getNetWorth).toHaveBeenCalledWith(from, to);
    expect(getSpending).toHaveBeenCalledWith(currentMonth);
    expect(apiFetch).toHaveBeenCalledWith('/subscriptions?limit=0');

    await waitFor(() =>
      expect(
        within(section('Spending by category')).getByText('Groceries'),
      ).toBeInTheDocument(),
    );
    await waitFor(() =>
      expect(
        within(section('Net worth')).getByTestId('net-worth-headline'),
      ).toHaveTextContent('$10,000.00'),
    );
    await waitFor(() =>
      expect(
        within(section('Subscriptions')).getByText('Netflix'),
      ).toBeInTheDocument(),
    );
  });

  it('shows a net worth error without blanking the other sections', async () => {
    vi.mocked(getNetWorth).mockRejectedValue(new Error('Net worth exploded'));
    render(<ReportsPage />);

    await waitFor(() =>
      expect(
        within(section('Net worth')).getByText('Net worth exploded'),
      ).toBeInTheDocument(),
    );
    expect(showErrorToast).toHaveBeenCalledWith('Net worth exploded');
    await waitFor(() =>
      expect(within(section('Cash flow')).getByText('Sep 2026')).toBeInTheDocument(),
    );
    expect(
      within(section('Spending by category')).getByText('Groceries'),
    ).toBeInTheDocument();
  });

  it('shows the cash flow empty state when every month is zero', async () => {
    vi.mocked(getCashFlow).mockResolvedValue({
      months: [
        { month: '2026-09', incomeCents: 0, expenseCents: 0, netCents: 0 },
        { month: '2026-10', incomeCents: 0, expenseCents: 0, netCents: 0 },
      ],
    });
    render(<ReportsPage />);

    const cash = section('Cash flow');
    await waitFor(() =>
      expect(
        within(cash).getByText('No transactions in this range'),
      ).toBeInTheDocument(),
    );
    expect(within(cash).getByRole('link')).toHaveAttribute(
      'href',
      '/transactions',
    );
  });

  it('shows the net worth empty state when there are no accounts', async () => {
    accountsState = { accounts: [] };
    vi.mocked(getNetWorth).mockResolvedValue({
      months: [
        {
          month: '2026-10',
          assetsCents: 0,
          liabilitiesCents: 0,
          netWorthCents: 0,
          accounts: [],
        },
      ],
    });
    render(<ReportsPage />);

    const net = section('Net worth');
    await waitFor(() =>
      expect(within(net).getByText('No accounts yet')).toBeInTheDocument(),
    );
    expect(within(net).getByRole('link')).toHaveAttribute('href', '/accounts');
  });

  it('shows the spending empty state when the month has no spend', async () => {
    vi.mocked(getSpending).mockResolvedValue({
      month: currentMonth,
      categories: [],
      uncategorizedCents: 0,
      totalCents: 0,
    });
    render(<ReportsPage />);

    await waitFor(() =>
      expect(
        within(section('Spending by category')).getByText(
          'No spending this month',
        ),
      ).toBeInTheDocument(),
    );
  });

  it('rejects a 37-month range without fetching', async () => {
    render(<ReportsPage />);
    await waitFor(() => expect(getCashFlow).toHaveBeenCalledTimes(1));
    const { to } = defaultRange();

    fireEvent.change(screen.getByLabelText('From'), {
      target: { value: shiftMonth(to, -36) },
    });

    expect(
      await screen.findByText(`Range must not exceed ${MAX_REPORT_MONTHS} months`),
    ).toBeInTheDocument();
    expect(getCashFlow).toHaveBeenCalledTimes(1);
    expect(getNetWorth).toHaveBeenCalledTimes(1);
  });

  it('accepts exactly 36 months', async () => {
    render(<ReportsPage />);
    await waitFor(() => expect(getCashFlow).toHaveBeenCalledTimes(1));
    const { to } = defaultRange();

    fireEvent.change(screen.getByLabelText('From'), {
      target: { value: shiftMonth(to, -35) },
    });

    await waitFor(() =>
      expect(getCashFlow).toHaveBeenLastCalledWith(shiftMonth(to, -35), to),
    );
    expect(
      screen.queryByText(`Range must not exceed ${MAX_REPORT_MONTHS} months`),
    ).not.toBeInTheDocument();
  });

  it('rejects a from month after the to month without fetching', async () => {
    render(<ReportsPage />);
    await waitFor(() => expect(getCashFlow).toHaveBeenCalledTimes(1));
    const { to } = defaultRange();

    fireEvent.change(screen.getByLabelText('From'), {
      target: { value: shiftMonth(to, 1) },
    });

    expect(
      await screen.findByText('From must not be after to'),
    ).toBeInTheDocument();
    expect(getCashFlow).toHaveBeenCalledTimes(1);
  });

  it('refetches spending when the month changes', async () => {
    render(<ReportsPage />);
    await waitFor(() => expect(getSpending).toHaveBeenCalledTimes(1));

    const previous = shiftMonth(currentMonth, -1);
    vi.mocked(getSpending).mockResolvedValue({ ...spending, month: previous });
    fireEvent.change(screen.getByLabelText('Month'), {
      target: { value: previous },
    });

    await waitFor(() =>
      expect(getSpending).toHaveBeenLastCalledWith(previous),
    );
  });

  it('charts net worth when only an earlier month in the range has accounts', async () => {
    vi.mocked(getNetWorth).mockResolvedValue({
      months: [
        { ...netWorth.months[0], month: '2026-09' },
        {
          month: '2026-10',
          assetsCents: 0,
          liabilitiesCents: 0,
          netWorthCents: 0,
          accounts: [],
        },
      ],
    });
    render(<ReportsPage />);

    const net = section('Net worth');
    await waitFor(() =>
      expect(within(net).getByTestId('net-worth-headline')).toBeInTheDocument(),
    );
    expect(within(net).queryByText('No accounts yet')).not.toBeInTheDocument();
  });

  it('says the range has no account history when the household has accounts', async () => {
    vi.mocked(getNetWorth).mockResolvedValue({
      months: [
        {
          month: '2026-10',
          assetsCents: 0,
          liabilitiesCents: 0,
          netWorthCents: 0,
          accounts: [],
        },
      ],
    });
    render(<ReportsPage />);

    const net = section('Net worth');
    await waitFor(() =>
      expect(
        within(net).getByText('No account history in this range'),
      ).toBeInTheDocument(),
    );
    expect(within(net).queryByText('No accounts yet')).not.toBeInTheDocument();
    expect(within(net).queryByRole('link')).not.toBeInTheDocument();
  });

  it('hides the spending chart and asks for a month when the input is cleared', async () => {
    render(<ReportsPage />);
    const spend = section('Spending by category');
    await waitFor(() =>
      expect(within(spend).getByText('Groceries')).toBeInTheDocument(),
    );

    fireEvent.change(screen.getByLabelText('Month'), { target: { value: '' } });

    expect(await within(spend).findByText('Choose a month')).toBeInTheDocument();
    expect(within(spend).queryByText('Groceries')).not.toBeInTheDocument();
    expect(getSpending).toHaveBeenCalledTimes(1);
  });

  it('shows the spending empty state when uncategorized is negative', async () => {
    vi.mocked(getSpending).mockResolvedValue({
      month: currentMonth,
      categories: [],
      uncategorizedCents: -500,
      totalCents: -500,
    });
    render(<ReportsPage />);

    await waitFor(() =>
      expect(
        within(section('Spending by category')).getByText(
          'No spending this month',
        ),
      ).toBeInTheDocument(),
    );
  });

  it('computes the default range once on mount', async () => {
    render(<ReportsPage />);
    await waitFor(() => expect(getCashFlow).toHaveBeenCalledTimes(1));
    expect(defaultRange).toHaveBeenCalledTimes(1);
  });
});
