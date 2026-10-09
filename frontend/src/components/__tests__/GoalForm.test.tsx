import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('@/lib/goals', () => ({
  createGoal: vi.fn(),
  updateGoal: vi.fn(),
}));
vi.mock('@/lib/toast', () => ({
  showErrorToast: vi.fn(),
  showSuccessToast: vi.fn(),
}));

import { createGoal, updateGoal } from '@/lib/goals';
import { showErrorToast, showSuccessToast } from '@/lib/toast';
import GoalForm from '@/components/GoalForm';
import type { BudgetCategory, Goal } from '@/lib/types';

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
  isArchived: false,
  createdAt: '',
  updatedAt: '',
};

describe('GoalForm', () => {
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
    expect(screen.getByLabelText('Target ($)')).toHaveValue(5000);
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

  it('calls onCancel', async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    render(<GoalForm categories={categories} onSaved={vi.fn()} onCancel={onCancel} />);
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalled();
  });
});
