import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('@/lib/labels', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/labels')>();
  return { ...actual, createLabel: vi.fn(), updateLabel: vi.fn() };
});
vi.mock('@/lib/toast', () => ({
  showErrorToast: vi.fn(),
  showSuccessToast: vi.fn(),
}));

import { createLabel, defaultLabelColor, updateLabel } from '@/lib/labels';
import { showErrorToast, showSuccessToast } from '@/lib/toast';
import LabelForm from '@/components/LabelForm';
import type { Label } from '@/lib/types';

const label: Label = {
  _id: 'l1',
  householdId: 'h',
  name: 'Etsy shop',
  color: '#2f8a93',
  isArchived: false,
  parentId: null,
  createdAt: '',
  updatedAt: '',
};

describe('LabelForm', () => {
  afterEach(() => vi.clearAllMocks());

  it('create mode: empty name and a color picked from the existing count', () => {
    render(
      <LabelForm existingCount={3} onSaved={vi.fn()} onCancel={vi.fn()} />,
    );
    expect(screen.getByRole('heading', { name: 'New label' })).toBeInTheDocument();
    expect(screen.getByLabelText('Name')).toHaveValue('');
    expect(screen.getByLabelText('Color')).toHaveValue(defaultLabelColor(3));
  });

  it('submits a create with the typed name and chosen color', async () => {
    vi.mocked(createLabel).mockResolvedValue(label);
    const onSaved = vi.fn();
    const user = userEvent.setup();

    render(<LabelForm onSaved={onSaved} onCancel={vi.fn()} />);
    await user.type(screen.getByLabelText('Name'), 'Consulting');
    fireEvent.input(screen.getByLabelText('Color'), {
      target: { value: '#112233' },
    });
    await user.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() =>
      expect(createLabel).toHaveBeenCalledWith({
        name: 'Consulting',
        color: '#112233',
      }),
    );
    expect(updateLabel).not.toHaveBeenCalled();
    expect(showSuccessToast).toHaveBeenCalledWith('Label created');
    expect(onSaved).toHaveBeenCalled();
  });

  it('edit mode: prefills the label and PATCHes the new values', async () => {
    vi.mocked(updateLabel).mockResolvedValue(label);
    const onSaved = vi.fn();
    const user = userEvent.setup();

    render(<LabelForm label={label} onSaved={onSaved} onCancel={vi.fn()} />);
    expect(screen.getByRole('heading', { name: 'Edit label' })).toBeInTheDocument();
    expect(screen.getByLabelText('Name')).toHaveValue('Etsy shop');
    expect(screen.getByLabelText('Color')).toHaveValue('#2f8a93');

    await user.clear(screen.getByLabelText('Name'));
    await user.type(screen.getByLabelText('Name'), 'Etsy store');
    await user.click(screen.getByRole('button', { name: 'Update' }));

    await waitFor(() =>
      expect(updateLabel).toHaveBeenCalledWith('l1', {
        name: 'Etsy store',
        color: '#2f8a93',
      }),
    );
    expect(createLabel).not.toHaveBeenCalled();
    expect(showSuccessToast).toHaveBeenCalledWith('Label updated');
    expect(onSaved).toHaveBeenCalled();
  });

  it('keeps the form open with an inline error when the API rejects', async () => {
    vi.mocked(createLabel).mockRejectedValue(
      new Error('A label named "Etsy shop" already exists'),
    );
    const onSaved = vi.fn();
    const user = userEvent.setup();

    render(<LabelForm onSaved={onSaved} onCancel={vi.fn()} />);
    await user.type(screen.getByLabelText('Name'), 'Etsy shop');
    await user.click(screen.getByRole('button', { name: 'Create' }));

    expect(
      await screen.findByText('A label named "Etsy shop" already exists'),
    ).toBeInTheDocument();
    expect(showErrorToast).toHaveBeenCalledWith(
      'A label named "Etsy shop" already exists',
    );
    expect(onSaved).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Name')).toHaveValue('Etsy shop');
  });

  it.each([
    ['create', undefined],
    ['edit', label],
  ])('rejects the reserved name Personal in %s mode', async (_mode, existing) => {
    const onSaved = vi.fn();
    const user = userEvent.setup();

    render(<LabelForm label={existing} onSaved={onSaved} onCancel={vi.fn()} />);
    await user.clear(screen.getByLabelText('Name'));
    await user.type(screen.getByLabelText('Name'), ' PERSONAL ');
    await user.click(
      screen.getByRole('button', { name: existing ? 'Update' : 'Create' }),
    );

    expect(
      screen.getByText('"Personal" is the built-in default and cannot be a label name'),
    ).toBeInTheDocument();
    expect(createLabel).not.toHaveBeenCalled();
    expect(updateLabel).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('calls onCancel from the Cancel button', async () => {
    const onCancel = vi.fn();
    const user = userEvent.setup();

    render(<LabelForm onSaved={vi.fn()} onCancel={onCancel} />);
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onCancel).toHaveBeenCalled();
    expect(createLabel).not.toHaveBeenCalled();
  });
});
