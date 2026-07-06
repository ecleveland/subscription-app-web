import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('@/lib/categories', () => ({
  createCategory: vi.fn(),
  updateCategory: vi.fn(),
}));
vi.mock('@/lib/toast', () => ({
  showErrorToast: vi.fn(),
  showSuccessToast: vi.fn(),
}));

import { createCategory, updateCategory } from '@/lib/categories';
import { showErrorToast, showSuccessToast } from '@/lib/toast';
import CategoryForm from '@/components/CategoryForm';
import type { BudgetCategory, CategoryGroup } from '@/lib/types';

const groups: CategoryGroup[] = [
  {
    _id: 'g1',
    householdId: 'h',
    name: 'Food',
    sortOrder: 0,
    createdAt: '',
    updatedAt: '',
  },
  {
    _id: 'g2',
    householdId: 'h',
    name: 'Income',
    sortOrder: 1,
    createdAt: '',
    updatedAt: '',
  },
];

const category: BudgetCategory = {
  _id: 'c1',
  householdId: 'h',
  groupId: 'g1',
  name: 'Groceries',
  isIncome: false,
  sortOrder: 0,
  isArchived: false,
  createdAt: '',
  updatedAt: '',
};

describe('CategoryForm', () => {
  afterEach(() => vi.clearAllMocks());

  it('create mode: shows name, group select with default, and income checkbox', () => {
    render(
      <CategoryForm
        groups={groups}
        defaultGroupId="g2"
        onSaved={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByLabelText('Name')).toHaveValue('');
    expect(screen.getByLabelText('Group')).toHaveValue('g2');
    expect(screen.getByLabelText('Income category')).not.toBeChecked();
  });

  it('submits a create with the typed values', async () => {
    vi.mocked(createCategory).mockResolvedValue(category);
    const onSaved = vi.fn();
    const user = userEvent.setup();

    render(
      <CategoryForm
        groups={groups}
        defaultGroupId="g1"
        onSaved={onSaved}
        onCancel={vi.fn()}
      />,
    );
    await user.type(screen.getByLabelText('Name'), 'Coffee');
    await user.selectOptions(screen.getByLabelText('Group'), 'g2');
    await user.click(screen.getByLabelText('Income category'));
    await user.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() =>
      expect(createCategory).toHaveBeenCalledWith({
        name: 'Coffee',
        groupId: 'g2',
        isIncome: true,
      }),
    );
    expect(showSuccessToast).toHaveBeenCalledWith('Category created');
    expect(onSaved).toHaveBeenCalled();
  });

  it('edit mode: prefills, hides the income checkbox, and PATCHes without isIncome', async () => {
    vi.mocked(updateCategory).mockResolvedValue(category);
    const onSaved = vi.fn();
    const user = userEvent.setup();

    render(
      <CategoryForm
        category={category}
        groups={groups}
        onSaved={onSaved}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByLabelText('Name')).toHaveValue('Groceries');
    expect(screen.queryByLabelText('Income category')).not.toBeInTheDocument();

    await user.clear(screen.getByLabelText('Name'));
    await user.type(screen.getByLabelText('Name'), 'Food shopping');
    await user.click(screen.getByRole('button', { name: 'Update' }));

    await waitFor(() =>
      expect(updateCategory).toHaveBeenCalledWith('c1', {
        name: 'Food shopping',
        groupId: 'g1',
      }),
    );
    expect(showSuccessToast).toHaveBeenCalledWith('Category updated');
    expect(onSaved).toHaveBeenCalled();
  });

  it('keeps the form open with an inline error when the API rejects', async () => {
    vi.mocked(createCategory).mockRejectedValue(
      new Error('A category named "Coffee" already exists in this group'),
    );
    const onSaved = vi.fn();
    const user = userEvent.setup();

    render(
      <CategoryForm
        groups={groups}
        defaultGroupId="g1"
        onSaved={onSaved}
        onCancel={vi.fn()}
      />,
    );
    await user.type(screen.getByLabelText('Name'), 'Coffee');
    await user.click(screen.getByRole('button', { name: 'Create' }));

    expect(
      await screen.findByText(
        'A category named "Coffee" already exists in this group',
      ),
    ).toBeInTheDocument();
    expect(showErrorToast).toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
    // Still editable — the form did not close or reset.
    expect(screen.getByLabelText('Name')).toHaveValue('Coffee');
  });
});
