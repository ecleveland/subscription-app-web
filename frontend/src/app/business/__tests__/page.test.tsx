import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// A fixed range keeps the month buttons the tests click independent of the
// clock. "This month" reads the last entry of the report, not the clock.
vi.mock('@/lib/reports', async (importActual) => ({
  ...(await importActual<typeof import('@/lib/reports')>()),
  defaultRange: () => ({ from: '2025-12', to: '2026-11' }),
  getBusinessReport: vi.fn(),
}));
vi.mock('@/lib/transactions', () => ({
  setReimbursement: vi.fn(),
  listTransactions: vi.fn(),
}));
vi.mock('@/lib/categories', () => ({ listCategories: vi.fn() }));
let labelsState: { labels: unknown[]; loading: boolean; error: string | null };
vi.mock('@/lib/labels-context', () => ({ useLabels: () => labelsState }));
let authState = { isAuthenticated: true };
vi.mock('@/lib/auth-context', () => ({ useAuth: () => authState }));
vi.mock('@/lib/toast', () => ({
  showErrorToast: vi.fn(),
  showSuccessToast: vi.fn(),
}));
const { mockPush } = vi.hoisted(() => ({ mockPush: vi.fn() }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, replace: vi.fn() }),
  usePathname: () => '/business',
}));

import {
  getBusinessReport,
  defaultRange,
  type BusinessReport,
  type BusinessReimbursementRow,
} from '@/lib/reports';
import { setReimbursement, listTransactions } from '@/lib/transactions';
import { listCategories } from '@/lib/categories';
import { showErrorToast, showSuccessToast } from '@/lib/toast';
import { shiftMonth } from '@/lib/budget';
import BusinessPage from '@/app/business/page';
import type { BudgetCategory, Label } from '@/lib/types';

// Recharts uses ResizeObserver internally
global.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

// jsdom has no modal dialog. Toggling the open attribute keeps the dialog in
// the accessibility tree only while it is open, as a browser does.
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
  });
  HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
    this.removeAttribute('open');
  });
});

const { from, to } = defaultRange();
const lastMonth = shiftMonth(to, -1);
const today = new Date().toISOString().slice(0, 10);
const daysAgo = (n: number) =>
  new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);

const labels: Label[] = [
  { _id: 'l1', householdId: 'h', name: 'Etsy shop', color: '#2f8a93', isArchived: false, createdAt: '', updatedAt: '' },
  { _id: 'l2', householdId: 'h', name: 'Old gig', color: '#6b4f9e', isArchived: true, createdAt: '', updatedAt: '' },
];

const categories: BudgetCategory[] = [
  { _id: 'c1', householdId: 'h', groupId: 'g', name: 'Supplies', isIncome: false, sortOrder: 0, isArchived: false, createdAt: '', updatedAt: '' },
];

function owedRow(overrides: Partial<BusinessReimbursementRow>): BusinessReimbursementRow {
  return {
    id: 't1',
    date: `${daysAgo(3)}T00:00:00.000Z`,
    payee: 'Kiln parts',
    amountCents: 5500,
    categoryId: 'c1',
    labelId: 'l1',
    ...overrides,
  };
}

function makeReport(overrides: Partial<BusinessReport> = {}): BusinessReport {
  const months = [];
  for (let m = from; m <= to; m = shiftMonth(m, 1)) {
    months.push({ month: m, expenseCents: 0, incomeCents: 0, reimbursedCents: 0 });
  }
  months[months.length - 2] = {
    month: lastMonth,
    expenseCents: 10000,
    incomeCents: 30000,
    reimbursedCents: 0,
  };
  months[months.length - 1] = {
    month: to,
    expenseCents: 22000,
    incomeCents: 30000,
    reimbursedCents: 5000,
  };
  return {
    from,
    to,
    labelId: null,
    months,
    categories: [
      {
        categoryId: 'c1',
        categoryName: 'Supplies',
        groupId: 'g',
        groupName: 'Business',
        actualCents: 32000,
        plannedCents: null,
      },
    ],
    uncategorizedCents: 0,
    totalCents: 32000,
    reimbursements: {
      owedCents: 7500,
      owedCount: 2,
      reimbursedCents: 5000,
      owed: [
        owedRow({ id: 't1', payee: 'Kiln parts', amountCents: 5500, date: `${daysAgo(3)}T00:00:00.000Z` }),
        owedRow({ id: 't2', payee: null, amountCents: 2000, date: `${today}T00:00:00.000Z`, categoryId: null }),
      ],
      reimbursed: [
        owedRow({
          id: 't3',
          payee: 'Glaze order',
          amountCents: 5000,
          reimbursedAt: '2026-11-02T12:00:00.000Z',
          reimbursedByTransactionId: null,
        }),
      ],
    },
    ...overrides,
  };
}

function section(name: string): HTMLElement {
  return screen.getByRole('region', { name });
}

function outstanding(): HTMLElement {
  return within(section('Reimbursements')).getByText(/^Outstanding:/);
}

async function renderLoaded() {
  render(<BusinessPage />);
  await within(section('Reimbursements')).findByText('Kiln parts');
}

beforeEach(() => {
  vi.mocked(getBusinessReport).mockReset().mockResolvedValue(makeReport());
  vi.mocked(setReimbursement).mockReset().mockResolvedValue({} as never);
  vi.mocked(listTransactions).mockReset().mockResolvedValue({
    data: [],
    meta: { total: 0, page: 1, limit: 20, totalPages: 0, hasNextPage: false },
  });
  vi.mocked(listCategories).mockReset().mockResolvedValue(categories);
  vi.mocked(showErrorToast).mockReset();
  vi.mocked(showSuccessToast).mockReset();
  mockPush.mockReset();
  authState = { isAuthenticated: true };
  labelsState = { labels, loading: false, error: null };
});

describe('BusinessPage', () => {
  it('fetches every label over the last 12 months by default', async () => {
    await renderLoaded();
    expect(getBusinessReport).toHaveBeenCalledWith(from, to, undefined);
    expect(screen.getByRole('heading', { level: 1, name: 'Business' })).toBeInTheDocument();
  });

  it('offers All business and each label with archived ones flagged', async () => {
    await renderLoaded();
    const select = screen.getByLabelText('Business label');
    expect(within(select).getAllByRole('option').map((o) => o.textContent)).toEqual([
      'All business',
      'Etsy shop',
      'Old gig (archived)',
    ]);
  });

  it('refetches with the label when one is picked', async () => {
    const user = userEvent.setup();
    await renderLoaded();

    await user.selectOptions(screen.getByLabelText('Business label'), 'l1');

    await waitFor(() =>
      expect(getBusinessReport).toHaveBeenLastCalledWith(from, to, 'l1'),
    );
  });

  describe('This month', () => {
    it('shows spend, income and net with the change against last month', async () => {
      await renderLoaded();
      const block = section('This month');

      const spend = within(block).getByRole('group', { name: 'Spend' });
      expect(spend).toHaveTextContent('$220.00');
      expect(spend).toHaveTextContent('+$120.00 vs last month');

      const income = within(block).getByRole('group', { name: 'Income' });
      expect(income).toHaveTextContent('$300.00');
      expect(income).toHaveTextContent('No change');

      const net = within(block).getByRole('group', { name: 'Net' });
      expect(net).toHaveTextContent('$80.00');
      expect(net).toHaveTextContent('-$120.00 vs last month');
    });
  });

  describe('Month to month', () => {
    function currentMonthExpenseCell() {
      const table = within(section('Month to month')).getByRole('table', {
        name: 'Cash flow by month',
      });
      const rows = within(table).getAllByRole('row');
      // Columns: month, income, expenses, net.
      return within(rows.at(-1)!).getAllByRole('cell')[1];
    }

    it('charts gross spend, and spend net of reimbursements when toggled', async () => {
      const user = userEvent.setup();
      await renderLoaded();

      expect(currentMonthExpenseCell()).toHaveTextContent('$220.00');

      await user.click(screen.getByLabelText('Net of reimbursements'));

      expect(currentMonthExpenseCell()).toHaveTextContent('$170.00');
    });

    it('opens the transactions list for a clicked month across every label', async () => {
      const user = userEvent.setup();
      await renderLoaded();

      await user.click(
        within(section('Month to month')).getByRole('button', { name: 'Oct 2026' }),
      );

      expect(mockPush).toHaveBeenCalledWith(
        '/transactions?labelId=any&dateFrom=2026-10-01&dateTo=2026-10-31',
      );
    });

    it('carries the picked label into the transactions link', async () => {
      const user = userEvent.setup();
      await renderLoaded();
      await user.selectOptions(screen.getByLabelText('Business label'), 'l1');
      await within(section('Reimbursements')).findByText('Kiln parts');

      await user.click(
        within(section('Month to month')).getByRole('button', { name: 'Feb 2026' }),
      );

      expect(mockPush).toHaveBeenCalledWith(
        '/transactions?labelId=l1&dateFrom=2026-02-01&dateTo=2026-02-28',
      );
    });

    it('says so when the range has no activity', async () => {
      vi.mocked(getBusinessReport).mockResolvedValue(
        makeReport({
          months: [{ month: to, expenseCents: 0, incomeCents: 0, reimbursedCents: 0 }],
          categories: [],
          totalCents: 0,
        }),
      );
      render(<BusinessPage />);

      expect(
        await within(section('Month to month')).findByText(
          'No business activity in this range',
        ),
      ).toBeInTheDocument();
      expect(
        within(section('Spend by category')).getByText('No business spend in this range'),
      ).toBeInTheDocument();
    });
  });

  describe('Spend by category', () => {
    it('charts category spend without a planned column', async () => {
      await renderLoaded();
      const table = within(section('Spend by category')).getByRole('table', {
        name: 'Spending by category',
      });
      expect(within(table).getByText('Supplies')).toBeInTheDocument();
      expect(within(table).queryByRole('columnheader', { name: 'Planned' })).toBeNull();
    });
  });

  describe('Reimbursements', () => {
    it('lists what is owed with the outstanding total', async () => {
      await renderLoaded();
      const block = section('Reimbursements');

      expect(outstanding()).toHaveTextContent('Outstanding: $75.00 across 2 expenses');

      const owed = within(block).getByRole('list', { name: 'Owed reimbursements' });
      const rows = within(owed).getAllByRole('listitem');
      expect(rows).toHaveLength(2);
      expect(rows[0]).toHaveTextContent('Kiln parts');
      expect(rows[0]).toHaveTextContent('3 days');
      expect(rows[0]).toHaveTextContent('Supplies');
      expect(rows[0]).toHaveTextContent('$55.00');
      // All business shows which label each row belongs to.
      expect(rows[0]).toHaveTextContent('Etsy shop');
      expect(rows[1]).toHaveTextContent('No payee');
      expect(rows[1]).toHaveTextContent('today');
    });

    it('drops the label chip when one label is picked', async () => {
      const user = userEvent.setup();
      await renderLoaded();
      await user.selectOptions(screen.getByLabelText('Business label'), 'l1');
      const owed = await within(section('Reimbursements')).findByRole('list', {
        name: 'Owed reimbursements',
      });

      expect(within(owed).queryByText('Etsy shop')).not.toBeInTheDocument();
    });

    it('lists reimbursed expenses with the date they were paid back', async () => {
      await renderLoaded();
      const list = within(section('Reimbursements')).getByRole('list', {
        name: 'Reimbursed expenses',
      });
      const row = within(list).getByRole('listitem');
      expect(row).toHaveTextContent('Glaze order');
      expect(row).toHaveTextContent('$50.00');
      expect(row).toHaveTextContent('Reimbursed Nov 2, 2026');
    });

    it('shows empty text for both lists', async () => {
      vi.mocked(getBusinessReport).mockResolvedValue(
        makeReport({
          reimbursements: {
            owedCents: 0,
            owedCount: 0,
            reimbursedCents: 0,
            owed: [],
            reimbursed: [],
          },
        }),
      );
      render(<BusinessPage />);
      const block = section('Reimbursements');

      expect(await within(block).findByText('Nothing owed in this range')).toBeInTheDocument();
      expect(
        within(block).getByText('No reimbursements recorded in this range'),
      ).toBeInTheDocument();
    });

    it('marks one expense reimbursed through the dialog and refetches', async () => {
      const user = userEvent.setup();
      await renderLoaded();
      const callsBefore = vi.mocked(getBusinessReport).mock.calls.length;
      const row = within(
        within(section('Reimbursements')).getByRole('list', { name: 'Owed reimbursements' }),
      ).getAllByRole('listitem')[0];

      await user.click(within(row).getByRole('button', { name: 'Mark reimbursed' }));
      const dialog = screen.getByRole('dialog', { name: 'Mark 1 expense reimbursed' });
      await user.click(within(dialog).getByRole('button', { name: 'Mark reimbursed' }));

      await waitFor(() =>
        expect(setReimbursement).toHaveBeenCalledWith('t1', {
          status: 'reimbursed',
          reimbursedAt: today,
        }),
      );
      expect(setReimbursement).toHaveBeenCalledTimes(1);
      await waitFor(() =>
        expect(showSuccessToast).toHaveBeenCalledWith('1 expense marked reimbursed'),
      );
      await waitFor(() =>
        expect(vi.mocked(getBusinessReport).mock.calls.length).toBe(callsBefore + 1),
      );
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('drops the item out of the owed list and lowers the total after marking', async () => {
      const user = userEvent.setup();
      await renderLoaded();
      const after = makeReport();
      after.reimbursements = {
        owedCents: 2000,
        owedCount: 1,
        reimbursedCents: 10500,
        owed: [after.reimbursements.owed[1]],
        reimbursed: [
          owedRow({ id: 't1', reimbursedAt: `${today}T00:00:00.000Z` }),
          ...after.reimbursements.reimbursed,
        ],
      };
      vi.mocked(getBusinessReport).mockResolvedValue(after);

      const owed = within(section('Reimbursements')).getByRole('list', {
        name: 'Owed reimbursements',
      });
      await user.click(
        within(within(owed).getAllByRole('listitem')[0]).getByRole('button', {
          name: 'Mark reimbursed',
        }),
      );
      await user.click(
        within(screen.getByRole('dialog')).getByRole('button', { name: 'Mark reimbursed' }),
      );

      const block = section('Reimbursements');
      await waitFor(() =>
        expect(outstanding()).toHaveTextContent('Outstanding: $20.00 across 1 expense'),
      );
      expect(
        within(within(block).getByRole('list', { name: 'Owed reimbursements' })).queryByText(
          'Kiln parts',
        ),
      ).not.toBeInTheDocument();
      expect(
        within(within(block).getByRole('list', { name: 'Reimbursed expenses' })).getByText(
          'Kiln parts',
        ),
      ).toBeInTheDocument();
    });

    it('marks every checked expense in bulk', async () => {
      const user = userEvent.setup();
      await renderLoaded();
      const block = section('Reimbursements');

      expect(within(block).queryByRole('button', { name: /^Mark \d+ reimbursed$/ })).toBeNull();
      await user.click(within(block).getByLabelText('Select Kiln parts'));
      await user.click(within(block).getByLabelText('Select expense'));
      await user.click(within(block).getByRole('button', { name: 'Mark 2 reimbursed' }));

      const dialog = screen.getByRole('dialog', { name: 'Mark 2 expenses reimbursed' });
      await user.click(within(dialog).getByRole('button', { name: 'Mark reimbursed' }));

      await waitFor(() => expect(setReimbursement).toHaveBeenCalledTimes(2));
      expect(setReimbursement).toHaveBeenCalledWith('t1', { status: 'reimbursed', reimbursedAt: today });
      expect(setReimbursement).toHaveBeenCalledWith('t2', { status: 'reimbursed', reimbursedAt: today });
      await waitFor(() =>
        expect(showSuccessToast).toHaveBeenCalledWith('2 expenses marked reimbursed'),
      );
    });

    it('clears the selection when the label changes', async () => {
      const user = userEvent.setup();
      await renderLoaded();

      await user.click(within(section('Reimbursements')).getByLabelText('Select Kiln parts'));
      expect(screen.getByRole('button', { name: 'Mark 1 reimbursed' })).toBeInTheDocument();

      await user.selectOptions(screen.getByLabelText('Business label'), 'l1');
      await within(section('Reimbursements')).findByText('Kiln parts');

      expect(screen.queryByRole('button', { name: 'Mark 1 reimbursed' })).toBeNull();
      expect(within(section('Reimbursements')).getByLabelText('Select Kiln parts')).not.toBeChecked();
    });

    it('keeps the other checked rows selected after marking one row by its own button', async () => {
      const base = makeReport();
      vi.mocked(getBusinessReport).mockResolvedValue({
        ...base,
        reimbursements: {
          ...base.reimbursements,
          owed: [
            ...base.reimbursements.owed,
            owedRow({ id: 't4', payee: 'Clay order', amountCents: 1500 }),
          ],
        },
      });
      const user = userEvent.setup();
      await renderLoaded();
      const block = section('Reimbursements');

      await user.click(within(block).getByLabelText('Select Kiln parts'));
      await user.click(within(block).getByLabelText('Select expense'));
      const clayRow = within(
        within(block).getByRole('list', { name: 'Owed reimbursements' }),
      )
        .getByText('Clay order')
        .closest('li')!;
      await user.click(within(clayRow).getByRole('button', { name: 'Mark reimbursed' }));
      await user.click(
        within(screen.getByRole('dialog')).getByRole('button', { name: 'Mark reimbursed' }),
      );

      await waitFor(() =>
        expect(setReimbursement).toHaveBeenCalledWith('t4', {
          status: 'reimbursed',
          reimbursedAt: today,
        }),
      );
      await waitFor(() => expect(showSuccessToast).toHaveBeenCalled());
      await within(section('Reimbursements')).findByText('Clay order');
      const after = section('Reimbursements');
      expect(within(after).getByLabelText('Select Kiln parts')).toBeChecked();
      expect(within(after).getByLabelText('Select expense')).toBeChecked();
      expect(screen.getByRole('button', { name: 'Mark 2 reimbursed' })).toBeInTheDocument();
    });

    it('marks a reimbursed expense as owed again', async () => {
      const user = userEvent.setup();
      await renderLoaded();
      const callsBefore = vi.mocked(getBusinessReport).mock.calls.length;
      const list = within(section('Reimbursements')).getByRole('list', {
        name: 'Reimbursed expenses',
      });

      await user.click(within(list).getByRole('button', { name: 'Mark as owed again' }));

      await waitFor(() =>
        expect(setReimbursement).toHaveBeenCalledWith('t3', { status: 'owed' }),
      );
      await waitFor(() => expect(showSuccessToast).toHaveBeenCalledWith('Marked as owed'));
      await waitFor(() =>
        expect(vi.mocked(getBusinessReport).mock.calls.length).toBe(callsBefore + 1),
      );
    });

    it('shows the error toast and keeps the dialog open when the update fails', async () => {
      vi.mocked(setReimbursement).mockRejectedValue(new Error('Save failed'));
      const user = userEvent.setup();
      await renderLoaded();
      const row = within(
        within(section('Reimbursements')).getByRole('list', { name: 'Owed reimbursements' }),
      ).getAllByRole('listitem')[0];

      await user.click(within(row).getByRole('button', { name: 'Mark reimbursed' }));
      await user.click(
        within(screen.getByRole('dialog')).getByRole('button', { name: 'Mark reimbursed' }),
      );

      await waitFor(() => expect(showErrorToast).toHaveBeenCalledWith('Save failed'));
      expect(showSuccessToast).not.toHaveBeenCalled();
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    it('reloads and keeps the failed ones selected when part of a bulk update fails', async () => {
      vi.mocked(setReimbursement).mockImplementation((id) =>
        id === 't2' ? Promise.reject(new Error('Save failed')) : Promise.resolve({} as never),
      );
      const user = userEvent.setup();
      await renderLoaded();
      const callsBefore = vi.mocked(getBusinessReport).mock.calls.length;
      const block = section('Reimbursements');

      await user.click(within(block).getByLabelText('Select Kiln parts'));
      await user.click(within(block).getByLabelText('Select expense'));
      await user.click(within(block).getByRole('button', { name: 'Mark 2 reimbursed' }));
      await user.click(
        within(screen.getByRole('dialog')).getByRole('button', { name: 'Mark reimbursed' }),
      );

      await waitFor(() =>
        expect(showErrorToast).toHaveBeenCalledWith('1 of 2 failed: Save failed'),
      );
      expect(showSuccessToast).toHaveBeenCalledWith('1 expense marked reimbursed');
      await waitFor(() =>
        expect(vi.mocked(getBusinessReport).mock.calls.length).toBe(callsBefore + 1),
      );
      await within(section('Reimbursements')).findByText('Kiln parts');
      expect(screen.getByRole('button', { name: 'Mark 1 reimbursed' })).toBeInTheDocument();
    });
  });

  it('shows an empty state and fetches nothing without labels', async () => {
    labelsState = { labels: [], loading: false, error: null };
    render(<BusinessPage />);

    expect(
      screen.getByText('No labels yet. Create one on the Categories page.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Categories/ })).toHaveAttribute(
      'href',
      '/categories',
    );
    await new Promise((r) => setTimeout(r, 0));
    expect(getBusinessReport).not.toHaveBeenCalled();
    expect(listCategories).not.toHaveBeenCalled();
  });

  it('shows the labels error instead of the empty state and fetches nothing', async () => {
    labelsState = { labels: [], loading: false, error: 'Labels down' };
    render(<BusinessPage />);

    expect(screen.getByText("Couldn't load labels: Labels down")).toBeInTheDocument();
    expect(screen.queryByText(/No labels yet/)).not.toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 0));
    expect(getBusinessReport).not.toHaveBeenCalled();
    expect(listCategories).not.toHaveBeenCalled();
  });

  it('keeps the select and the report when labels are known, with the error above them', async () => {
    labelsState = { labels, loading: false, error: 'Labels down' };
    render(<BusinessPage />);

    expect(screen.getByText("Couldn't load labels: Labels down")).toBeInTheDocument();
    expect(screen.getByLabelText('Business label')).toBeInTheDocument();
    await within(section('Reimbursements')).findByText('Kiln parts');
    expect(getBusinessReport).toHaveBeenCalledWith('2025-12', '2026-11', undefined);
    expect(listCategories).toHaveBeenCalled();
  });

  it('waits for labels before deciding the page is empty', () => {
    labelsState = { labels: [], loading: true, error: null };
    render(<BusinessPage />);

    expect(screen.queryByText(/No labels yet/)).not.toBeInTheDocument();
    expect(getBusinessReport).not.toHaveBeenCalled();
  });

  it('fetches nothing when signed out', async () => {
    authState = { isAuthenticated: false };
    render(<BusinessPage />);
    await new Promise((r) => setTimeout(r, 0));
    expect(getBusinessReport).not.toHaveBeenCalled();
  });
});
