import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('@/lib/budget', async (importOriginal) => {
  // Pure helpers (buildBudgetGroups, shiftMonth, formatMonth) run for real —
  // only the network wrappers are mocked.
  const actual = await importOriginal<typeof import('@/lib/budget')>();
  return { ...actual, getBudget: vi.fn(), setCategoryLimit: vi.fn() };
});
vi.mock('@/lib/categories', () => ({
  listCategories: vi.fn(),
  listCategoryGroups: vi.fn(),
}));
vi.mock('@/lib/toast', () => ({
  showErrorToast: vi.fn(),
  showSuccessToast: vi.fn(),
}));

import {
  getBudget,
  setCategoryLimit,
  shiftMonth,
  type BudgetView,
} from '@/lib/budget';
import { listCategories, listCategoryGroups } from '@/lib/categories';
import { showErrorToast, showSuccessToast } from '@/lib/toast';
import BudgetPage from '@/app/budget/page';
import type { BudgetCategory, CategoryGroup } from '@/lib/types';

const CURRENT_MONTH = new Date().toISOString().slice(0, 7);

function group(over: Partial<CategoryGroup>): CategoryGroup {
  return {
    _id: 'g?',
    householdId: 'h',
    name: '?',
    sortOrder: 0,
    createdAt: '',
    updatedAt: '',
    ...over,
  };
}

function category(over: Partial<BudgetCategory>): BudgetCategory {
  return {
    _id: 'c?',
    householdId: 'h',
    groupId: 'g1',
    name: '?',
    isIncome: false,
    sortOrder: 0,
    isArchived: false,
    createdAt: '',
    updatedAt: '',
    ...over,
  };
}

function budgetView(over: Partial<BudgetView> = {}): BudgetView {
  return {
    month: CURRENT_MONTH,
    categories: [],
    totalPlannedCents: 0,
    totalActualCents: 0,
    incomeCents: 0,
    toBeBudgetedCents: 0,
    ...over,
  };
}

// Out of sortOrder to prove the page sorts via buildBudgetGroups.
const groups = [
  group({ _id: 'g2', name: 'Income', sortOrder: 1 }),
  group({ _id: 'g1', name: 'Food', sortOrder: 0 }),
];
const categories = [
  category({ _id: 'c2', name: 'Dining out', sortOrder: 1 }),
  category({ _id: 'c1', name: 'Groceries', sortOrder: 0 }),
  category({ _id: 'c3', name: 'Paycheck', groupId: 'g2', isIncome: true }),
];

const defaultView = budgetView({
  categories: [
    {
      categoryId: 'c1',
      plannedCents: 50000,
      actualCents: 12000,
      remainingCents: 38000,
      isIncome: false,
    },
  ],
  totalPlannedCents: 50000,
  totalActualCents: 12000,
  incomeCents: 300000,
  toBeBudgetedCents: 250000,
});

function groceriesRow() {
  const rows = within(screen.getByRole('region', { name: 'Food' })).getAllByRole(
    'listitem',
  );
  return rows.find((r) => r.textContent?.includes('Groceries'))!;
}

async function renderPage() {
  render(<BudgetPage />);
  await screen.findByRole('region', { name: 'Food' });
}

describe('BudgetPage', () => {
  beforeEach(() => {
    vi.mocked(getBudget).mockResolvedValue(defaultView);
    vi.mocked(listCategories).mockResolvedValue(categories);
    vi.mocked(listCategoryGroups).mockResolvedValue(groups);
  });
  afterEach(() => vi.clearAllMocks());

  it('shows the loading state', () => {
    vi.mocked(getBudget).mockReturnValue(new Promise(() => {}));
    render(<BudgetPage />);
    expect(screen.getByText('Loading budget…')).toBeInTheDocument();
  });

  it('loads the current month and includes archived categories in the fetch', async () => {
    await renderPage();
    expect(getBudget).toHaveBeenCalledWith(CURRENT_MONTH);
    expect(listCategories).toHaveBeenCalledWith(true);
  });

  it('renders grouped rows with planned, actual, and remaining', async () => {
    await renderPage();

    const sections = screen.getAllByRole('region');
    expect(sections.map((s) => s.getAttribute('aria-label'))).toEqual([
      'Budget summary',
      'Food',
      'Income',
    ]);

    const row = groceriesRow();
    expect(within(row).getByText('$500.00')).toBeInTheDocument();
    expect(within(row).getByText('$120.00')).toBeInTheDocument();
    expect(within(row).getByText('$380.00')).toBeInTheDocument();
  });

  it('renders categories without budget data as zeroed rows', async () => {
    await renderPage();
    const rows = within(
      screen.getByRole('region', { name: 'Food' }),
    ).getAllByRole('listitem');
    const dining = rows.find((r) => r.textContent?.includes('Dining out'))!;
    expect(within(dining).getAllByText('$0.00')).toHaveLength(3);
  });

  it('marks archived categories with spend and offers no edit affordance', async () => {
    vi.mocked(listCategories).mockResolvedValue([
      ...categories,
      category({ _id: 'c4', name: 'Old Hobby', sortOrder: 2, isArchived: true }),
    ]);
    vi.mocked(getBudget).mockResolvedValue(
      budgetView({
        categories: [
          {
            categoryId: 'c4',
            plannedCents: 0,
            actualCents: 500,
            remainingCents: -500,
            isIncome: false,
          },
        ],
      }),
    );
    await renderPage();

    const rows = within(
      screen.getByRole('region', { name: 'Food' }),
    ).getAllByRole('listitem');
    const archived = rows.find((r) => r.textContent?.includes('Old Hobby'))!;
    expect(within(archived).getByText('(archived)')).toBeInTheDocument();
    expect(
      within(archived).queryByRole('button', {
        name: 'Edit limit for Old Hobby',
      }),
    ).not.toBeInTheDocument();
  });

  it('flags over-budget expense rows', async () => {
    vi.mocked(getBudget).mockResolvedValue(
      budgetView({
        categories: [
          {
            categoryId: 'c1',
            plannedCents: 10000,
            actualCents: 12200,
            remainingCents: -2200,
            isIncome: false,
          },
        ],
      }),
    );
    await renderPage();

    const row = groceriesRow();
    expect(within(row).getByText('Over budget')).toBeInTheDocument();
    expect(within(row).getByText('-$22.00')).toBeInTheDocument();
    expect(within(row).getByRole('progressbar')).toHaveAttribute(
      'aria-valuenow',
      '100',
    );
  });

  it('does not flag income rows with negative remaining', async () => {
    vi.mocked(getBudget).mockResolvedValue(
      budgetView({
        categories: [
          {
            categoryId: 'c3',
            plannedCents: 300000,
            actualCents: 350000,
            remainingCents: -50000,
            isIncome: true,
          },
        ],
      }),
    );
    await renderPage();
    expect(screen.queryByText('Over budget')).not.toBeInTheDocument();
  });

  it('sizes the progress bar from actual/planned', async () => {
    await renderPage();
    // 12000 / 50000 = 24%
    expect(
      within(groceriesRow()).getByRole('progressbar'),
    ).toHaveAttribute('aria-valuenow', '24');
  });

  it('renders the summary header from the view totals', async () => {
    await renderPage();
    const summary = screen.getByRole('region', { name: 'Budget summary' });
    expect(within(summary).getByText('$500.00')).toBeInTheDocument();
    expect(within(summary).getByText('$120.00')).toBeInTheDocument();
    expect(within(summary).getByText('$2,500.00')).toBeInTheDocument();
    expect(
      within(summary).getByText('of $3,000.00 income'),
    ).toBeInTheDocument();
  });

  it('flags negative to-be-budgeted', async () => {
    vi.mocked(getBudget).mockResolvedValue(
      budgetView({
        ...defaultView,
        incomeCents: 40000,
        toBeBudgetedCents: -10000,
      }),
    );
    await renderPage();
    const summary = screen.getByRole('region', { name: 'Budget summary' });
    expect(within(summary).getByText('-$100.00')).toBeInTheDocument();
    expect(within(summary).getByText('Over-allocated')).toBeInTheDocument();
  });

  it('saves an edited limit and applies the returned view', async () => {
    const updated = budgetView({
      ...defaultView,
      categories: [
        {
          categoryId: 'c1',
          plannedCents: 60000,
          actualCents: 12000,
          remainingCents: 48000,
          isIncome: false,
        },
      ],
      totalPlannedCents: 60000,
      toBeBudgetedCents: 240000,
    });
    vi.mocked(setCategoryLimit).mockResolvedValue(updated);
    await renderPage();
    const user = userEvent.setup();

    await user.click(
      screen.getByRole('button', { name: 'Edit limit for Groceries' }),
    );
    const input = screen.getByRole('textbox', {
      name: 'Monthly limit for Groceries',
    });
    expect(input).toHaveValue('500.00');
    await user.clear(input);
    await user.type(input, '600');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(setCategoryLimit).toHaveBeenCalledWith(CURRENT_MONTH, 'c1', 60000);
    expect(showSuccessToast).toHaveBeenCalled();
    // Returned view applied without a refetch.
    expect(await within(groceriesRow()).findByText('$600.00')).toBeInTheDocument();
    expect(getBudget).toHaveBeenCalledTimes(1);
  });

  it('rejects an invalid amount without calling the API', async () => {
    await renderPage();
    const user = userEvent.setup();

    await user.click(
      screen.getByRole('button', { name: 'Edit limit for Groceries' }),
    );
    const input = screen.getByRole('textbox', {
      name: 'Monthly limit for Groceries',
    });
    await user.clear(input);
    await user.type(input, 'abc');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(setCategoryLimit).not.toHaveBeenCalled();
    expect(showErrorToast).toHaveBeenCalled();
    // Still editing.
    expect(
      screen.getByRole('textbox', { name: 'Monthly limit for Groceries' }),
    ).toBeInTheDocument();
  });

  it('resyncs after a failed save', async () => {
    vi.mocked(setCategoryLimit).mockRejectedValue(new Error('nope'));
    await renderPage();
    const user = userEvent.setup();

    await user.click(
      screen.getByRole('button', { name: 'Edit limit for Groceries' }),
    );
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(showErrorToast).toHaveBeenCalled();
    // Initial load + resync.
    expect(getBudget).toHaveBeenCalledTimes(2);
  });

  it('switches months with prev/next and refetches only the budget', async () => {
    await renderPage();
    const user = userEvent.setup();

    vi.mocked(getBudget).mockClear();
    await user.click(screen.getByRole('button', { name: 'Previous month' }));
    // shiftMonth's rollover behavior is unit-tested in lib/__tests__/budget.test.ts.
    expect(getBudget).toHaveBeenCalledWith(shiftMonth(CURRENT_MONTH, -1));

    await user.click(screen.getByRole('button', { name: 'Next month' }));
    expect(getBudget).toHaveBeenLastCalledWith(CURRENT_MONTH);

    // The category catalog is month-independent — fetched once, not per switch.
    expect(listCategories).toHaveBeenCalledTimes(1);
    expect(listCategoryGroups).toHaveBeenCalledTimes(1);
  });

  it('does not render the old month while a new month loads', async () => {
    await renderPage();
    const user = userEvent.setup();

    vi.mocked(getBudget).mockReturnValue(new Promise(() => {}));
    await user.click(screen.getByRole('button', { name: 'Previous month' }));

    expect(screen.getByText('Loading budget…')).toBeInTheDocument();
    expect(
      screen.queryByRole('region', { name: 'Food' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('region', { name: 'Budget summary' }),
    ).not.toBeInTheDocument();
  });

  it('saves an empty edit field as a zero limit', async () => {
    vi.mocked(setCategoryLimit).mockResolvedValue(defaultView);
    await renderPage();
    const user = userEvent.setup();

    // Dining out has no budget entry, so the editor prefills empty.
    await user.click(
      screen.getByRole('button', { name: 'Edit limit for Dining out' }),
    );
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(setCategoryLimit).toHaveBeenCalledWith(CURRENT_MONTH, 'c2', 0);
  });

  it('keeps a newly opened editor when an earlier save resolves', async () => {
    let resolveSave!: (v: BudgetView) => void;
    vi.mocked(setCategoryLimit).mockImplementation(
      () => new Promise((res) => (resolveSave = res)),
    );
    await renderPage();
    const user = userEvent.setup();

    await user.click(
      screen.getByRole('button', { name: 'Edit limit for Groceries' }),
    );
    await user.click(screen.getByRole('button', { name: 'Save' }));

    // While the save is in flight, start editing another row.
    await user.click(
      screen.getByRole('button', { name: 'Edit limit for Dining out' }),
    );
    await act(async () => resolveSave(defaultView));
    await waitFor(() => expect(showSuccessToast).toHaveBeenCalled());

    expect(
      screen.getByRole('textbox', { name: 'Monthly limit for Dining out' }),
    ).toBeInTheDocument();
  });

  it('discards a stale refetch that resolves after a save', async () => {
    await renderPage();
    const user = userEvent.setup();

    const updated = budgetView({
      ...defaultView,
      categories: [
        {
          categoryId: 'c1',
          plannedCents: 60000,
          actualCents: 12000,
          remainingCents: 48000,
          isIncome: false,
        },
      ],
    });
    let resolveSave!: (v: BudgetView) => void;
    vi.mocked(setCategoryLimit).mockImplementation(
      () => new Promise((res) => (resolveSave = res)),
    );
    let resolveBack!: (v: BudgetView) => void;
    vi.mocked(getBudget)
      .mockImplementationOnce(() => new Promise(() => {})) // previous month, abandoned
      .mockImplementationOnce(() => new Promise((res) => (resolveBack = res)));

    // Save in flight, then bounce away and back — the "back" refetch reads
    // pre-save data.
    await user.click(
      screen.getByRole('button', { name: 'Edit limit for Groceries' }),
    );
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await user.click(screen.getByRole('button', { name: 'Previous month' }));
    await user.click(screen.getByRole('button', { name: 'Next month' }));

    await act(async () => resolveSave(updated));
    expect(
      await within(groceriesRow()).findByText('$600.00'),
    ).toBeInTheDocument();

    // The stale pre-save view must not clobber the applied save.
    await act(async () => resolveBack(defaultView));
    await waitFor(() =>
      expect(within(groceriesRow()).getByText('$600.00')).toBeInTheDocument(),
    );
    expect(within(groceriesRow()).queryByText('$500.00')).not.toBeInTheDocument();
  });

  it('renders an empty-budget month as zeroed rows', async () => {
    vi.mocked(getBudget).mockResolvedValue(budgetView());
    await renderPage();
    const rows = within(
      screen.getByRole('region', { name: 'Food' }),
    ).getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(within(row).getAllByText('$0.00')).toHaveLength(3);
    }
  });

  it('shows a setup CTA when there are no categories', async () => {
    vi.mocked(listCategories).mockResolvedValue([]);
    vi.mocked(listCategoryGroups).mockResolvedValue([]);
    render(<BudgetPage />);
    expect(
      await screen.findByText('Set up your categories to start budgeting.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /categories/i })).toHaveAttribute(
      'href',
      '/categories',
    );
  });

  it('surfaces a load error', async () => {
    vi.mocked(getBudget).mockRejectedValue(new Error('Failed to load budget'));
    render(<BudgetPage />);
    expect(
      await screen.findByText('Failed to load budget'),
    ).toBeInTheDocument();
  });
});
