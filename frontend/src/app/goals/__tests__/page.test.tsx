import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('@/lib/goals', async (importOriginal) => {
  // Pure helpers (goalProgress, daysUntilTarget) run for real. Only the
  // network wrappers are mocked.
  const actual = await importOriginal<typeof import('@/lib/goals')>();
  return {
    ...actual,
    listGoals: vi.fn(),
    createGoal: vi.fn(),
    updateGoal: vi.fn(),
    contributeToGoal: vi.fn(),
    deleteGoal: vi.fn(),
  };
});
vi.mock('@/lib/categories', () => ({ listCategories: vi.fn() }));
let authState = { isAuthenticated: true };
vi.mock('@/lib/auth-context', () => ({ useAuth: () => authState }));
vi.mock('@/lib/toast', () => ({
  showErrorToast: vi.fn(),
  showSuccessToast: vi.fn(),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/goals',
}));

import { listGoals, createGoal, updateGoal, contributeToGoal } from '@/lib/goals';
import { listCategories } from '@/lib/categories';
import { showErrorToast } from '@/lib/toast';
import GoalsPage from '@/app/goals/page';
import type { Goal } from '@/lib/types';

function goal(over: Partial<Goal>): Goal {
  return {
    _id: 'g?',
    householdId: 'h',
    name: '?',
    type: 'savings',
    targetCents: 10000,
    currentCents: 0,
    targetDate: null,
    categoryId: null,
    isArchived: false,
    createdAt: '',
    updatedAt: '',
    ...over,
  };
}

const empty = goal({ _id: 'g0', name: 'Vacation', currentCents: 0 });
const half = goal({ _id: 'g1', name: 'Emergency fund', currentCents: 5000 });
const over = goal({ _id: 'g2', name: 'Card payoff', type: 'debt', currentCents: 12000 });
const archived = goal({ _id: 'g3', name: 'Old laptop', isArchived: true });

function card(name: string) {
  return screen.getByRole('article', { name });
}

function barWidth(name: string) {
  const bar = within(card(name)).getByRole('progressbar');
  return (bar.firstElementChild as HTMLElement).style.width;
}

describe('GoalsPage', () => {
  beforeEach(() => {
    authState = { isAuthenticated: true };
    vi.mocked(listGoals).mockImplementation(async (includeArchived) =>
      includeArchived ? [empty, half, over, archived] : [empty, half, over],
    );
    vi.mocked(listCategories).mockResolvedValue([]);
  });
  afterEach(() => vi.clearAllMocks());

  it('does not fetch until authenticated', () => {
    authState = { isAuthenticated: false };
    render(<GoalsPage />);
    expect(listGoals).not.toHaveBeenCalled();
    expect(listCategories).not.toHaveBeenCalled();
  });

  it('shows loading, then goals with progress labels and clamped bars', async () => {
    render(<GoalsPage />);
    expect(screen.getByRole('heading', { level: 1, name: 'Goals' })).toBeInTheDocument();
    expect(screen.getByText('Loading goals…')).toBeInTheDocument();

    await screen.findByRole('article', { name: 'Vacation' });
    expect(listGoals).toHaveBeenCalledWith(false);
    expect(within(card('Vacation')).getByText('0%')).toBeInTheDocument();
    expect(barWidth('Vacation')).toBe('0%');
    expect(within(card('Emergency fund')).getByText('50%')).toBeInTheDocument();
    expect(barWidth('Emergency fund')).toBe('50%');
    expect(within(card('Card payoff')).getByText('120%')).toBeInTheDocument();
    expect(barWidth('Card payoff')).toBe('100%');
  });

  it('shows the empty state with the add button', async () => {
    vi.mocked(listGoals).mockResolvedValue([]);
    render(<GoalsPage />);
    expect(await screen.findByText(/No goals yet/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '+ Add goal' })).toBeInTheDocument();
  });

  it('surfaces a load failure', async () => {
    vi.mocked(listGoals).mockRejectedValue(new Error('Network down'));
    render(<GoalsPage />);
    expect(await screen.findByText('Network down')).toBeInTheDocument();
  });

  it('offers Try again and + Add goal after a failed load, and retry refetches', async () => {
    const user = userEvent.setup();
    vi.mocked(listGoals).mockRejectedValueOnce(new Error('Network down'));
    render(<GoalsPage />);
    expect(await screen.findByText('Network down')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '+ Add goal' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Try again' }));

    expect(await screen.findByRole('article', { name: 'Vacation' })).toBeInTheDocument();
    expect(listGoals).toHaveBeenCalledTimes(2);
    expect(screen.queryByText('Network down')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
  });

  it('toasts a categories failure while goals still render', async () => {
    vi.mocked(listCategories).mockRejectedValue(new Error('Categories down'));
    render(<GoalsPage />);
    expect(await screen.findByRole('article', { name: 'Vacation' })).toBeInTheDocument();
    await waitFor(() => expect(showErrorToast).toHaveBeenCalledWith('Categories down'));
  });

  it('hints in the create form when categories failed to load', async () => {
    const user = userEvent.setup();
    vi.mocked(listCategories).mockRejectedValue(new Error('Categories down'));
    render(<GoalsPage />);
    await screen.findByRole('article', { name: 'Vacation' });
    await waitFor(() => expect(showErrorToast).toHaveBeenCalled());

    await user.click(screen.getByRole('button', { name: '+ Add goal' }));

    expect(
      screen.getByText("Couldn't load categories. You can set one later."),
    ).toBeInTheDocument();
  });

  it('shows no categories hint when categories loaded', async () => {
    const user = userEvent.setup();
    render(<GoalsPage />);
    await screen.findByRole('article', { name: 'Vacation' });
    await user.click(screen.getByRole('button', { name: '+ Add goal' }));
    expect(screen.queryByText(/Couldn't load categories/)).toBeNull();
  });

  it('posts a contribution and re-renders the card from the response', async () => {
    const user = userEvent.setup();
    vi.mocked(contributeToGoal).mockResolvedValue({ ...half, currentCents: 7500 });
    render(<GoalsPage />);
    await screen.findByRole('article', { name: 'Emergency fund' });

    const c = card('Emergency fund');
    await user.type(within(c).getByLabelText('Contribution ($)'), '25');
    await user.click(within(c).getByRole('button', { name: 'Add' }));

    expect(contributeToGoal).toHaveBeenCalledWith('g1', 2500);
    await waitFor(() =>
      expect(within(card('Emergency fund')).getByText('75%')).toBeInTheDocument(),
    );
    expect(within(card('Emergency fund')).getByText('$75.00 of $100.00')).toBeInTheDocument();
  });

  it('sends a negative contribution as negative cents', async () => {
    const user = userEvent.setup();
    vi.mocked(contributeToGoal).mockResolvedValue({ ...half, currentCents: 4000 });
    render(<GoalsPage />);
    await screen.findByRole('article', { name: 'Emergency fund' });

    const c = card('Emergency fund');
    await user.type(within(c).getByLabelText('Contribution ($)'), '-10');
    await user.click(within(c).getByRole('button', { name: 'Add' }));

    expect(contributeToGoal).toHaveBeenCalledWith('g1', -1000);
    await waitFor(() =>
      expect(within(card('Emergency fund')).getByText('40%')).toBeInTheDocument(),
    );
  });

  it('toasts a failed contribution and leaves the card alone', async () => {
    const user = userEvent.setup();
    vi.mocked(contributeToGoal).mockRejectedValue(new Error('Goal not found'));
    render(<GoalsPage />);
    await screen.findByRole('article', { name: 'Emergency fund' });

    const c = card('Emergency fund');
    await user.type(within(c).getByLabelText('Contribution ($)'), '5');
    await user.click(within(c).getByRole('button', { name: 'Add' }));

    await waitFor(() => expect(showErrorToast).toHaveBeenCalledWith('Goal not found'));
    expect(within(c).getByText('50%')).toBeInTheDocument();
  });

  it('hides archived goals until Show archived refetches with true', async () => {
    const user = userEvent.setup();
    render(<GoalsPage />);
    await screen.findByRole('article', { name: 'Vacation' });
    expect(screen.queryByRole('article', { name: 'Old laptop' })).toBeNull();

    await user.click(screen.getByRole('checkbox', { name: 'Show archived' }));

    expect(await screen.findByRole('article', { name: 'Old laptop' })).toBeInTheDocument();
    expect(listGoals).toHaveBeenLastCalledWith(true);
    expect(within(card('Old laptop')).getByRole('button', { name: 'Unarchive' })).toBeInTheDocument();
  });

  it('clears the stale list when a refetch after toggling fails', async () => {
    const user = userEvent.setup();
    render(<GoalsPage />);
    await user.click(await screen.findByRole('checkbox', { name: 'Show archived' }));
    await screen.findByRole('article', { name: 'Old laptop' });

    vi.mocked(listGoals).mockRejectedValueOnce(new Error('Network down'));
    await user.click(screen.getByRole('checkbox', { name: 'Show archived' }));

    expect(await screen.findByText('Network down')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Show archived' })).not.toBeChecked();
    expect(screen.queryByRole('article')).toBeNull();
  });

  it('archives a goal and drops it from the active list', async () => {
    const user = userEvent.setup();
    vi.mocked(updateGoal).mockResolvedValue({ ...half, isArchived: true });
    render(<GoalsPage />);
    await screen.findByRole('article', { name: 'Emergency fund' });

    await user.click(within(card('Emergency fund')).getByRole('button', { name: 'Archive' }));

    expect(updateGoal).toHaveBeenCalledWith('g1', { isArchived: true });
    await waitFor(() =>
      expect(screen.queryByRole('article', { name: 'Emergency fund' })).toBeNull(),
    );
  });

  it('unarchives a goal in place when archived goals are shown', async () => {
    const user = userEvent.setup();
    vi.mocked(updateGoal).mockResolvedValue({ ...archived, isArchived: false });
    render(<GoalsPage />);
    await screen.findByRole('article', { name: 'Vacation' });
    await user.click(screen.getByRole('checkbox', { name: 'Show archived' }));
    await screen.findByRole('article', { name: 'Old laptop' });

    await user.click(within(card('Old laptop')).getByRole('button', { name: 'Unarchive' }));

    expect(updateGoal).toHaveBeenCalledWith('g3', { isArchived: false });
    await waitFor(() =>
      expect(within(card('Old laptop')).getByRole('button', { name: 'Archive' })).toBeInTheDocument(),
    );
  });

  it.each([
    { label: 'Archive', start: half, showArchived: false },
    { label: 'Unarchive', start: archived, showArchived: true },
  ])('toasts a failed $label and leaves the card as it was', async ({ label, start, showArchived }) => {
    const user = userEvent.setup();
    vi.mocked(updateGoal).mockRejectedValue(new Error('Update failed'));
    render(<GoalsPage />);
    await screen.findByRole('article', { name: 'Vacation' });
    if (showArchived) {
      await user.click(screen.getByRole('checkbox', { name: 'Show archived' }));
    }
    await screen.findByRole('article', { name: start.name });

    await user.click(within(card(start.name)).getByRole('button', { name: label }));

    await waitFor(() => expect(showErrorToast).toHaveBeenCalledWith('Update failed'));
    expect(updateGoal).toHaveBeenCalledWith(start._id, { isArchived: !start.isArchived });
    expect(within(card(start.name)).getByRole('button', { name: label })).toBeInTheDocument();
  });

  it('keeps the edit form open with the error when updateGoal rejects', async () => {
    const user = userEvent.setup();
    vi.mocked(updateGoal).mockRejectedValue(new Error('Name taken'));
    render(<GoalsPage />);
    await screen.findByRole('article', { name: 'Emergency fund' });

    await user.click(within(card('Emergency fund')).getByRole('button', { name: 'Edit' }));
    await user.clear(screen.getByLabelText('Name'));
    await user.type(screen.getByLabelText('Name'), 'Rainy day');
    await user.click(screen.getByRole('button', { name: 'Update' }));

    await waitFor(() => expect(showErrorToast).toHaveBeenCalledWith('Name taken'));
    expect(screen.getByText('Name taken', { selector: 'p' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Update' })).toBeInTheDocument();
    expect(screen.getByRole('article', { name: 'Emergency fund' })).toBeInTheDocument();
    expect(screen.queryByRole('article', { name: 'Rainy day' })).toBeNull();
  });

  it('closes the edit form when the goal being edited is archived', async () => {
    const user = userEvent.setup();
    vi.mocked(updateGoal).mockResolvedValue({ ...half, isArchived: true });
    render(<GoalsPage />);
    await screen.findByRole('article', { name: 'Emergency fund' });

    await user.click(within(card('Emergency fund')).getByRole('button', { name: 'Edit' }));
    expect(screen.getByRole('button', { name: 'Update' })).toBeInTheDocument();
    await user.click(within(card('Emergency fund')).getByRole('button', { name: 'Archive' }));

    await waitFor(() =>
      expect(screen.queryByRole('article', { name: 'Emergency fund' })).toBeNull(),
    );
    expect(screen.queryByRole('button', { name: 'Update' })).toBeNull();
  });

  it('keeps the edit form open when a different goal is archived', async () => {
    const user = userEvent.setup();
    vi.mocked(updateGoal).mockResolvedValue({ ...empty, isArchived: true });
    render(<GoalsPage />);
    await screen.findByRole('article', { name: 'Emergency fund' });

    await user.click(within(card('Emergency fund')).getByRole('button', { name: 'Edit' }));
    await user.click(within(card('Vacation')).getByRole('button', { name: 'Archive' }));

    await waitFor(() =>
      expect(screen.queryByRole('article', { name: 'Vacation' })).toBeNull(),
    );
    expect(screen.getByLabelText('Name')).toHaveValue('Emergency fund');
  });

  it('adds a created goal to the list', async () => {
    const user = userEvent.setup();
    const created = goal({ _id: 'g9', name: 'House', targetCents: 2000000 });
    vi.mocked(createGoal).mockResolvedValue(created);
    render(<GoalsPage />);
    await screen.findByRole('article', { name: 'Vacation' });

    await user.click(screen.getByRole('button', { name: '+ Add goal' }));
    await user.type(screen.getByLabelText('Name'), 'House');
    await user.type(screen.getByLabelText('Target ($)'), '20000');
    await user.click(screen.getByRole('button', { name: 'Create' }));

    expect(await screen.findByRole('article', { name: 'House' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Create' })).toBeNull();
  });

  it('shows the error toast when createGoal rejects', async () => {
    const user = userEvent.setup();
    vi.mocked(createGoal).mockRejectedValue(new Error('targetCents must not be less than 1'));
    render(<GoalsPage />);
    await screen.findByRole('article', { name: 'Vacation' });

    await user.click(screen.getByRole('button', { name: '+ Add goal' }));
    await user.type(screen.getByLabelText('Name'), 'House');
    await user.type(screen.getByLabelText('Target ($)'), '10');
    await user.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() =>
      expect(showErrorToast).toHaveBeenCalledWith('targetCents must not be less than 1'),
    );
    expect(screen.getByRole('button', { name: 'Create' })).toBeInTheDocument();
  });

  it('opens the form prefilled for Edit and replaces the goal on save', async () => {
    const user = userEvent.setup();
    vi.mocked(updateGoal).mockResolvedValue({ ...half, name: 'Rainy day' });
    render(<GoalsPage />);
    await screen.findByRole('article', { name: 'Emergency fund' });

    await user.click(within(card('Emergency fund')).getByRole('button', { name: 'Edit' }));
    expect(screen.getByLabelText('Name')).toHaveValue('Emergency fund');
    await user.clear(screen.getByLabelText('Name'));
    await user.type(screen.getByLabelText('Name'), 'Rainy day');
    await user.click(screen.getByRole('button', { name: 'Update' }));

    expect(await screen.findByRole('article', { name: 'Rainy day' })).toBeInTheDocument();
    expect(screen.queryByRole('article', { name: 'Emergency fund' })).toBeNull();
  });
});
