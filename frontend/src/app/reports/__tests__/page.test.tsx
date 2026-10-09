import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

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
let accountsState: {
  accounts: unknown[];
  loading: boolean;
  error: string | null;
};
vi.mock('@/lib/accounts-context', () => ({ useAccounts: () => accountsState }));
vi.mock('@/lib/api', () => ({ apiFetch: vi.fn() }));
let authState = { isAuthenticated: true };
vi.mock('@/lib/auth-context', () => ({ useAuth: () => authState }));
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

// jsdom sanitizes a malformed value on a month input to "", which would hide
// the bug. Safari has no month picker and renders a text input, so partial
// keystrokes reach onChange as typed. Switch the input to text to match.
function typeLikeSafari(label: string, value: string) {
  const input = screen.getByLabelText(label);
  input.setAttribute('type', 'text');
  fireEvent.change(input, { target: { value } });
}

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
  authState = { isAuthenticated: true };
  accountsState = {
    accounts: [{ _id: 'a1', name: 'Checking' }],
    loading: false,
    error: null,
  };
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
    expect(showErrorToast).toHaveBeenCalledWith(
      'Net worth: Net worth exploded',
    );
    await waitFor(() =>
      expect(within(section('Cash flow')).getByText('Sep 2026')).toBeInTheDocument(),
    );
    expect(
      within(section('Spending by category')).getByText('Groceries'),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(within(section('Subscriptions')).getByText('Netflix')).toBeInTheDocument(),
    );
  });

  it('shows a subscriptions error without blanking the other sections', async () => {
    vi.mocked(apiFetch).mockRejectedValue(new Error('Subscriptions down'));
    render(<ReportsPage />);

    await waitFor(() =>
      expect(
        within(section('Subscriptions')).getByText('Subscriptions down'),
      ).toBeInTheDocument(),
    );
    expect(showErrorToast).toHaveBeenCalledWith(
      'Subscriptions: Subscriptions down',
    );
    await waitFor(() =>
      expect(within(section('Cash flow')).getByText('Sep 2026')).toBeInTheDocument(),
    );
  });

  it('fetches nothing when signed out', async () => {
    authState = { isAuthenticated: false };
    render(<ReportsPage />);

    // Let any effects and microtasks settle before asserting absence.
    await waitFor(() =>
      expect(
        screen.getByRole('heading', { level: 1, name: 'Reports' }),
      ).toBeInTheDocument(),
    );
    await new Promise((r) => setTimeout(r, 0));
    expect(getCashFlow).not.toHaveBeenCalled();
    expect(getNetWorth).not.toHaveBeenCalled();
    expect(getSpending).not.toHaveBeenCalled();
    expect(apiFetch).not.toHaveBeenCalled();
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
    accountsState = { accounts: [], loading: false, error: null };
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

  describe.each(['From', 'To'])('a malformed %s month', (label) => {
    it.each(['2026-1', 'abc'])('rejects %j without fetching', async (value) => {
      render(<ReportsPage />);
      await waitFor(() => expect(getCashFlow).toHaveBeenCalledTimes(1));

      typeLikeSafari(label, value);

      expect(
        await screen.findByText('Months must be in YYYY-MM format'),
      ).toBeInTheDocument();
      expect(getCashFlow).toHaveBeenCalledTimes(1);
      expect(getNetWorth).toHaveBeenCalledTimes(1);
      expect(showErrorToast).not.toHaveBeenCalled();
    });
  });

  it.each(['2026-1', 'abc'])(
    'asks for a month without fetching when Month is %j',
    async (value) => {
      render(<ReportsPage />);
      const spend = section('Spending by category');
      await waitFor(() =>
        expect(within(spend).getByText('Groceries')).toBeInTheDocument(),
      );

      typeLikeSafari('Month', value);

      expect(await within(spend).findByText('Choose a month')).toBeInTheDocument();
      expect(within(spend).queryByText('Groceries')).not.toBeInTheDocument();
      expect(getSpending).toHaveBeenCalledTimes(1);
      expect(showErrorToast).not.toHaveBeenCalled();
    },
  );

  const noAccountMonths: NetWorthReport = {
    months: [
      {
        month: '2026-10',
        assetsCents: 0,
        liabilitiesCents: 0,
        netWorthCents: 0,
        accounts: [],
      },
    ],
  };

  it('shows net worth as loading while the accounts list is still loading', async () => {
    accountsState = { accounts: [], loading: true, error: null };
    vi.mocked(getNetWorth).mockResolvedValue(noAccountMonths);
    render(<ReportsPage />);

    const net = section('Net worth');
    await waitFor(() => expect(getNetWorth).toHaveBeenCalled());
    await waitFor(() =>
      expect(within(net).getByText('Loading net worth…')).toBeInTheDocument(),
    );
    // Give the resolved report a chance to render before asserting absence.
    await new Promise((r) => setTimeout(r, 0));
    expect(within(net).getByText('Loading net worth…')).toBeInTheDocument();
    expect(within(net).queryByText('No accounts yet')).not.toBeInTheDocument();
    expect(within(net).queryByRole('link')).not.toBeInTheDocument();
  });

  it('says accounts could not load instead of prompting to add one', async () => {
    accountsState = { accounts: [], loading: false, error: 'Accounts down' };
    vi.mocked(getNetWorth).mockResolvedValue(noAccountMonths);
    render(<ReportsPage />);

    const net = section('Net worth');
    await waitFor(() =>
      expect(within(net).getByText("Couldn't load accounts")).toBeInTheDocument(),
    );
    expect(within(net).queryByText('No accounts yet')).not.toBeInTheDocument();
    expect(within(net).queryByRole('link')).not.toBeInTheDocument();
  });

  it('hides the old cash flow chart while a new range loads', async () => {
    render(<ReportsPage />);
    const cash = section('Cash flow');
    await waitFor(() =>
      expect(within(cash).getByText('Sep 2026')).toBeInTheDocument(),
    );

    let resolveNext!: (r: CashFlowReport) => void;
    vi.mocked(getCashFlow).mockReturnValue(
      new Promise<CashFlowReport>((res) => {
        resolveNext = res;
      }),
    );
    const { to } = defaultRange();
    fireEvent.change(screen.getByLabelText('From'), {
      target: { value: shiftMonth(to, -2) },
    });

    expect(within(cash).queryByText('Sep 2026')).not.toBeInTheDocument();
    expect(within(cash).getByText('Loading cash flow…')).toBeInTheDocument();

    await act(async () =>
      resolveNext({
        months: [
          { month: '2026-08', incomeCents: 100, expenseCents: 0, netCents: 100 },
        ],
      }),
    );
    expect(within(cash).getByText('Aug 2026')).toBeInTheDocument();
  });
});
