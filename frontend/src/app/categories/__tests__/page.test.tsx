import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('@/lib/categories', () => ({
  listCategories: vi.fn(),
  listCategoryGroups: vi.fn(),
  createCategory: vi.fn(),
  createCategoryGroup: vi.fn(),
  updateCategoryGroup: vi.fn(),
  updateCategory: vi.fn(),
  reorderCategories: vi.fn(),
  reorderCategoryGroups: vi.fn(),
}));
vi.mock('@/lib/toast', () => ({
  showErrorToast: vi.fn(),
  showSuccessToast: vi.fn(),
}));
// CategoryForm renders for real: its lib and toast imports are mocked above,
// and the edit-switch regression below depends on its internal state.

import {
  listCategories,
  listCategoryGroups,
  createCategory,
  createCategoryGroup,
  updateCategoryGroup,
  updateCategory,
  reorderCategories,
  reorderCategoryGroups,
} from '@/lib/categories';
import { showErrorToast, showSuccessToast } from '@/lib/toast';
import CategoriesPage from '@/app/categories/page';
import type { BudgetCategory, CategoryGroup } from '@/lib/types';

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

// Arrays deliberately out of sortOrder to prove the page sorts.
const groups = [
  group({ _id: 'g2', name: 'Income', sortOrder: 1 }),
  group({ _id: 'g1', name: 'Food', sortOrder: 0 }),
];
const categories = [
  category({ _id: 'c2', name: 'Dining out', sortOrder: 1 }),
  category({ _id: 'c1', name: 'Groceries', sortOrder: 0 }),
  category({ _id: 'c3', name: 'Paycheck', groupId: 'g2', isIncome: true }),
  category({ _id: 'c4', name: 'Old Hobby', sortOrder: 2, isArchived: true }),
];

function foodSection() {
  return screen.getByRole('region', { name: 'Food' });
}

async function renderPage() {
  render(<CategoriesPage />);
  await screen.findByRole('region', { name: 'Food' });
}

describe('CategoriesPage', () => {
  beforeAll(() => {
    HTMLDialogElement.prototype.showModal = vi.fn();
    HTMLDialogElement.prototype.close = vi.fn();
  });
  beforeEach(() => {
    vi.mocked(listCategories).mockResolvedValue(categories);
    vi.mocked(listCategoryGroups).mockResolvedValue(groups);
  });
  afterEach(() => vi.clearAllMocks());

  it('shows the loading state', () => {
    vi.mocked(listCategories).mockReturnValue(new Promise(() => {}));
    vi.mocked(listCategoryGroups).mockReturnValue(new Promise(() => {}));
    render(<CategoriesPage />);
    expect(screen.getByText('Loading categories…')).toBeInTheDocument();
  });

  it('renders groups and categories ordered by sortOrder', async () => {
    await renderPage();
    expect(listCategories).toHaveBeenCalledWith(true);

    // Groups in sortOrder: Food before Income.
    const sections = screen.getAllByRole('region');
    expect(sections[0]).toHaveAccessibleName('Food');
    expect(sections[1]).toHaveAccessibleName('Income');

    // Categories within Food in sortOrder.
    const rows = within(foodSection()).getAllByRole('listitem');
    expect(rows[0]).toHaveTextContent('Groceries');
    expect(rows[1]).toHaveTextContent('Dining out');

    // Income badge on income categories.
    const paycheckRow = within(
      screen.getByRole('region', { name: 'Income' }),
    ).getByRole('listitem');
    expect(within(paycheckRow).getByText('Income')).toBeInTheDocument();
  });

  it('keeps archived categories out of groups and inside the archived section', async () => {
    await renderPage();
    expect(
      within(foodSection()).queryByText('Old Hobby'),
    ).not.toBeInTheDocument();

    const toggle = screen.getByRole('button', {
      name: 'Archived categories (1)',
    });
    const user = userEvent.setup();
    await user.click(toggle);

    const archivedRow = screen
      .getAllByRole('listitem')
      .find((li) => li.textContent?.includes('Old Hobby'))!;
    expect(archivedRow).toBeDefined();
    // Shows which group it belongs to and offers unarchive.
    expect(within(archivedRow).getByText(/Food/)).toBeInTheDocument();
    expect(
      within(archivedRow).getByRole('button', { name: 'Unarchive' }),
    ).toBeInTheDocument();
  });

  it('surfaces a load error', async () => {
    vi.mocked(listCategories).mockRejectedValue(
      new Error('Failed to load categories'),
    );
    render(<CategoriesPage />);
    expect(
      await screen.findByText(/Failed to load categories/),
    ).toBeInTheDocument();
  });

  it('opens the category form from a group "+ Add category" button', async () => {
    await renderPage();
    const user = userEvent.setup();
    await user.click(
      within(foodSection()).getByRole('button', { name: '+ Add category' }),
    );
    expect(
      screen.getByRole('heading', { name: 'New category' }),
    ).toBeInTheDocument();
    // The form defaults to the group whose button was clicked.
    expect(screen.getByLabelText('Group')).toHaveValue('g1');
  });

  it('re-prefills the edit form when switching Edit between categories', async () => {
    await renderPage();
    const user = userEvent.setup();

    const groceriesRow = within(foodSection())
      .getAllByRole('listitem')
      .find((li) => li.textContent?.includes('Groceries'))!;
    await user.click(within(groceriesRow).getByRole('button', { name: 'Edit' }));
    expect(screen.getByLabelText('Name')).toHaveValue('Groceries');

    const diningRow = within(foodSection())
      .getAllByRole('listitem')
      .find((li) => li.textContent?.includes('Dining out'))!;
    await user.click(within(diningRow).getByRole('button', { name: 'Edit' }));
    expect(screen.getByLabelText('Name')).toHaveValue('Dining out');
  });

  it('disables move buttons while a reorder is in flight', async () => {
    let resolveReorder!: (value: BudgetCategory[]) => void;
    vi.mocked(reorderCategories).mockReturnValue(
      new Promise((resolve) => {
        resolveReorder = resolve;
      }),
    );
    await renderPage();
    const user = userEvent.setup();

    await user.click(
      screen.getByRole('button', { name: 'Move Groceries down' }),
    );
    expect(
      screen.getByRole('button', { name: 'Move Dining out up' }),
    ).toBeDisabled();
    expect(
      screen.getByRole('button', { name: 'Move group Income up' }),
    ).toBeDisabled();

    resolveReorder(categories);
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Move Dining out up' }),
      ).toBeEnabled(),
    );
  });

  it('creates a group and refreshes', async () => {
    vi.mocked(createCategoryGroup).mockResolvedValue(
      group({ _id: 'g3', name: 'Pets', sortOrder: 2 }),
    );
    await renderPage();
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: '+ Add group' }));
    await user.type(screen.getByLabelText('New group name'), 'Pets');
    await user.click(screen.getByRole('button', { name: 'Add', exact: true }));

    await waitFor(() =>
      expect(createCategoryGroup).toHaveBeenCalledWith({ name: 'Pets' }),
    );
    expect(showSuccessToast).toHaveBeenCalledWith('Group created');
    // Initial load + refresh.
    expect(listCategoryGroups).toHaveBeenCalledTimes(2);
  });

  it('renames a group inline', async () => {
    vi.mocked(updateCategoryGroup).mockResolvedValue(
      group({ _id: 'g1', name: 'Home', sortOrder: 0 }),
    );
    await renderPage();
    const user = userEvent.setup();

    await user.click(
      within(foodSection()).getByRole('button', { name: 'Rename' }),
    );
    const input = screen.getByLabelText('Group name');
    expect(input).toHaveValue('Food');
    await user.clear(input);
    await user.type(input, 'Home');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(updateCategoryGroup).toHaveBeenCalledWith('g1', { name: 'Home' }),
    );
    expect(showSuccessToast).toHaveBeenCalledWith('Group renamed');
  });

  it('archives a category through the confirm dialog', async () => {
    vi.mocked(updateCategory).mockResolvedValue(
      category({ _id: 'c1', isArchived: true }),
    );
    await renderPage();
    const user = userEvent.setup();

    const groceriesRow = within(foodSection())
      .getAllByRole('listitem')
      .find((li) => li.textContent?.includes('Groceries'))!;
    await user.click(
      within(groceriesRow).getByRole('button', { name: 'Archive' }),
    );
    // The dialog's confirm button (hidden in jsdom).
    await user.click(
      screen.getAllByRole('button', { name: 'Archive', hidden: true }).at(-1)!,
    );

    await waitFor(() =>
      expect(updateCategory).toHaveBeenCalledWith('c1', { isArchived: true }),
    );
    expect(showSuccessToast).toHaveBeenCalledWith('Category archived');
    expect(listCategories).toHaveBeenCalledTimes(2);
  });

  it('unarchives from the archived section', async () => {
    vi.mocked(updateCategory).mockResolvedValue(
      category({ _id: 'c4', isArchived: false }),
    );
    await renderPage();
    const user = userEvent.setup();

    await user.click(
      screen.getByRole('button', { name: 'Archived categories (1)' }),
    );
    await user.click(screen.getByRole('button', { name: 'Unarchive' }));

    await waitFor(() =>
      expect(updateCategory).toHaveBeenCalledWith('c4', { isArchived: false }),
    );
    expect(showSuccessToast).toHaveBeenCalledWith('Category restored');
  });

  it('reorders within a group and re-renders from the response', async () => {
    const reordered = [
      category({ _id: 'c2', name: 'Dining out', sortOrder: 0 }),
      category({ _id: 'c1', name: 'Groceries', sortOrder: 1 }),
      category({ _id: 'c3', name: 'Paycheck', groupId: 'g2', isIncome: true }),
      category({ _id: 'c4', name: 'Old Hobby', sortOrder: 2, isArchived: true }),
    ];
    vi.mocked(reorderCategories).mockResolvedValue(reordered);
    await renderPage();
    const user = userEvent.setup();

    await user.click(
      screen.getByRole('button', { name: 'Move Groceries down' }),
    );

    await waitFor(() =>
      expect(reorderCategories).toHaveBeenCalledWith(['c2', 'c1']),
    );
    const rows = within(foodSection()).getAllByRole('listitem');
    expect(rows[0]).toHaveTextContent('Dining out');
    expect(rows[1]).toHaveTextContent('Groceries');
  });

  it('disables move buttons at the edges', async () => {
    await renderPage();
    expect(
      screen.getByRole('button', { name: 'Move Groceries up' }),
    ).toBeDisabled();
    expect(
      screen.getByRole('button', { name: 'Move Dining out down' }),
    ).toBeDisabled();
    // Sole category in its group can't move at all.
    expect(
      screen.getByRole('button', { name: 'Move Paycheck up' }),
    ).toBeDisabled();
    expect(
      screen.getByRole('button', { name: 'Move Paycheck down' }),
    ).toBeDisabled();
    // Group edges.
    expect(
      screen.getByRole('button', { name: 'Move group Food up' }),
    ).toBeDisabled();
    expect(
      screen.getByRole('button', { name: 'Move group Income down' }),
    ).toBeDisabled();
  });

  it('creates a category through the form and refreshes the list', async () => {
    vi.mocked(createCategory).mockResolvedValue(
      category({ _id: 'c9', name: 'Coffee' }),
    );
    await renderPage();
    const user = userEvent.setup();

    await user.click(
      within(foodSection()).getByRole('button', { name: '+ Add category' }),
    );
    await user.type(screen.getByLabelText('Name'), 'Coffee');
    await user.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() =>
      expect(createCategory).toHaveBeenCalledWith({
        name: 'Coffee',
        groupId: 'g1',
        isIncome: false,
      }),
    );
    // The inline form closes and the list refetches.
    expect(
      screen.queryByRole('heading', { name: 'New category' }),
    ).not.toBeInTheDocument();
    expect(listCategories).toHaveBeenCalledTimes(2);
  });

  it('warns when the refresh after a save fails', async () => {
    vi.mocked(createCategoryGroup).mockResolvedValue(
      group({ _id: 'g3', name: 'Pets', sortOrder: 2 }),
    );
    await renderPage();
    vi.mocked(listCategoryGroups).mockRejectedValue(new Error('down'));
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: '+ Add group' }));
    await user.type(screen.getByLabelText('New group name'), 'Pets');
    await user.click(screen.getByRole('button', { name: 'Add', exact: true }));

    await waitFor(() =>
      expect(showErrorToast).toHaveBeenCalledWith(
        'Saved, but the category list may be out of date.',
      ),
    );
  });

  it('clears the load-error banner once a refresh succeeds', async () => {
    vi.mocked(listCategories).mockRejectedValueOnce(
      new Error('Failed to load categories'),
    );
    vi.mocked(createCategoryGroup).mockResolvedValue(
      group({ _id: 'g3', name: 'Pets', sortOrder: 2 }),
    );
    render(<CategoriesPage />);
    expect(
      await screen.findByText(/Failed to load categories/),
    ).toBeInTheDocument();

    // A later successful mutation refresh replaces the stale banner.
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: '+ Add group' }));
    await user.type(screen.getByLabelText('New group name'), 'Pets');
    await user.click(screen.getByRole('button', { name: 'Add', exact: true }));

    await screen.findByRole('region', { name: 'Food' });
    expect(
      screen.queryByText(/Failed to load categories/),
    ).not.toBeInTheDocument();
  });

  it('reorders groups through the bulk endpoint and re-renders from the response', async () => {
    vi.mocked(listCategoryGroups).mockResolvedValue([
      ...groups,
      group({ _id: 'g3', name: 'Savings', sortOrder: 2 }),
    ]);
    vi.mocked(reorderCategoryGroups).mockResolvedValue([
      group({ _id: 'g2', name: 'Income', sortOrder: 0 }),
      group({ _id: 'g1', name: 'Food', sortOrder: 1 }),
      group({ _id: 'g3', name: 'Savings', sortOrder: 2 }),
    ]);
    await renderPage();
    const user = userEvent.setup();

    await user.click(
      screen.getByRole('button', { name: 'Move group Food down' }),
    );

    // Display order was [Food, Income, Savings]; the move sends the full id
    // list with the pair swapped — one request.
    await waitFor(() =>
      expect(reorderCategoryGroups).toHaveBeenCalledWith(['g2', 'g1', 'g3']),
    );
    // The response is the refreshed list: no per-group PATCHes, no extra GET.
    const sections = screen.getAllByRole('region');
    expect(sections[0]).toHaveAccessibleName('Income');
    expect(sections[1]).toHaveAccessibleName('Food');
    expect(updateCategoryGroup).not.toHaveBeenCalled();
    expect(listCategoryGroups).toHaveBeenCalledTimes(1);
  });

  it('discards a stale reorder response when another mutation lands first', async () => {
    let resolveReorder!: (value: BudgetCategory[]) => void;
    vi.mocked(reorderCategories).mockReturnValue(
      new Promise((resolve) => {
        resolveReorder = resolve;
      }),
    );
    vi.mocked(updateCategory).mockResolvedValue(
      category({ _id: 'c4', isArchived: false }),
    );
    await renderPage();
    const user = userEvent.setup();

    // Reorder in flight (server snapshots the list with Old Hobby archived)…
    await user.click(
      screen.getByRole('button', { name: 'Move Groceries down' }),
    );

    // …meanwhile the user unarchives Old Hobby, whose refresh applies a list
    // where it is active.
    const unarchivedList = categories.map((c) =>
      c._id === 'c4' ? { ...c, isArchived: false } : c,
    );
    vi.mocked(listCategories).mockResolvedValue(unarchivedList);
    await user.click(
      screen.getByRole('button', { name: 'Archived categories (1)' }),
    );
    await user.click(screen.getByRole('button', { name: 'Unarchive' }));
    await waitFor(() =>
      expect(
        within(foodSection()).getByText('Old Hobby'),
      ).toBeInTheDocument(),
    );

    // The stale reorder snapshot must not resurrect the archived state.
    resolveReorder(categories);
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Move Groceries down' }),
      ).toBeEnabled(),
    );
    expect(within(foodSection()).getByText('Old Hobby')).toBeInTheDocument();
  });

  it('discards a stale group-reorder response when another mutation lands first', async () => {
    let resolveReorder!: (value: CategoryGroup[]) => void;
    vi.mocked(reorderCategoryGroups).mockReturnValue(
      new Promise((resolve) => {
        resolveReorder = resolve;
      }),
    );
    vi.mocked(updateCategoryGroup).mockResolvedValue(
      group({ _id: 'g1', name: 'Home', sortOrder: 0 }),
    );
    await renderPage();
    const user = userEvent.setup();

    // Group reorder in flight (server snapshots groups named Food/Income)…
    await user.click(
      screen.getByRole('button', { name: 'Move group Food down' }),
    );

    // …meanwhile the user renames Food to Home, whose refresh applies it.
    vi.mocked(listCategoryGroups).mockResolvedValue([
      group({ _id: 'g2', name: 'Income', sortOrder: 1 }),
      group({ _id: 'g1', name: 'Home', sortOrder: 0 }),
    ]);
    await user.click(
      within(screen.getByRole('region', { name: 'Food' })).getByRole(
        'button',
        { name: 'Rename' },
      ),
    );
    await user.clear(screen.getByLabelText('Group name'));
    await user.type(screen.getByLabelText('Group name'), 'Home');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByRole('region', { name: 'Home' });

    // The stale reorder snapshot must not resurrect the old name.
    resolveReorder(groups);
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Move group Home down' }),
      ).toBeEnabled(),
    );
    expect(screen.getByRole('region', { name: 'Home' })).toBeInTheDocument();
    expect(
      screen.queryByRole('region', { name: 'Food' }),
    ).not.toBeInTheDocument();
  });

  it('toasts and refetches when a group reorder fails', async () => {
    vi.mocked(reorderCategoryGroups).mockRejectedValue(new Error('flaky'));
    await renderPage();
    const user = userEvent.setup();

    await user.click(
      screen.getByRole('button', { name: 'Move group Food down' }),
    );

    await waitFor(() => expect(showErrorToast).toHaveBeenCalledWith('flaky'));
    // Initial load + resync: a failed bulkWrite can partially apply, so pull
    // whatever the server actually persisted.
    expect(listCategoryGroups).toHaveBeenCalledTimes(2);
  });

  it('toasts and refetches when a reorder fails', async () => {
    vi.mocked(reorderCategories).mockRejectedValue(new Error('nope'));
    await renderPage();
    const user = userEvent.setup();

    await user.click(
      screen.getByRole('button', { name: 'Move Groceries down' }),
    );

    await waitFor(() => expect(showErrorToast).toHaveBeenCalledWith('nope'));
    // Initial load + resync refetch.
    expect(listCategories).toHaveBeenCalledTimes(2);
  });

  it('asks for a reload when both the reorder and the resync fail', async () => {
    vi.mocked(reorderCategories).mockRejectedValue(new Error('nope'));
    await renderPage();
    // The resync refetch dies too — the on-screen order can no longer be
    // trusted (the failed bulk write may have partially applied).
    vi.mocked(listCategories).mockRejectedValue(new Error('still down'));
    const user = userEvent.setup();

    await user.click(
      screen.getByRole('button', { name: 'Move Groceries down' }),
    );

    await waitFor(() => expect(showErrorToast).toHaveBeenCalledWith('nope'));
    await waitFor(() =>
      expect(showErrorToast).toHaveBeenCalledWith(
        'Couldn’t confirm the current order — reload the page.',
      ),
    );
  });
});
