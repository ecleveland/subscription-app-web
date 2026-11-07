import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('@/lib/labels', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/labels')>();
  return { ...actual, createLabel: vi.fn() };
});
vi.mock('@/lib/toast', () => ({
  showErrorToast: vi.fn(),
  showSuccessToast: vi.fn(),
}));

import { createLabel, defaultLabelColor } from '@/lib/labels';
import { showErrorToast } from '@/lib/toast';
import LabelPicker from '@/components/LabelPicker';
import type { Label } from '@/lib/types';

function makeLabel(overrides: Partial<Label>): Label {
  return {
    _id: 'l1',
    householdId: 'h',
    name: 'Etsy shop',
    color: '#2f8a93',
    isArchived: false,
    parentId: null,
    createdAt: '',
    updatedAt: '',
    ...overrides,
  };
}

const etsy = makeLabel({ _id: 'l1', name: 'Etsy shop' });
const consulting = makeLabel({
  _id: 'l2',
  name: 'Consulting',
  color: '#6b4f9e',
});
const oldShop = makeLabel({
  _id: 'l3',
  name: 'Old shop',
  color: '#c29a2a',
  isArchived: true,
});

function renderPicker(props: Partial<React.ComponentProps<typeof LabelPicker>> = {}) {
  const onChange = vi.fn();
  const onCreated = vi.fn();
  render(
    <LabelPicker
      id="txn-label"
      labels={[]}
      value={null}
      onChange={onChange}
      onCreated={onCreated}
      {...props}
    />,
  );
  return { onChange, onCreated };
}

describe('LabelPicker', () => {
  afterEach(() => vi.clearAllMocks());

  it('renders only the Personal radio when there are no labels', () => {
    renderPicker();
    const group = screen.getByRole('radiogroup', { name: 'Label' });
    expect(group).toBeInTheDocument();
    const radios = screen.getAllByRole('radio');
    expect(radios).toHaveLength(1);
    expect(radios[0]).toHaveAccessibleName('Personal');
    expect(radios[0]).toBeChecked();
  });

  it('renders Personal and the single label as radios and reports clicks', async () => {
    const user = userEvent.setup();
    const { onChange } = renderPicker({ labels: [etsy], value: null });

    expect(screen.getByRole('radiogroup', { name: 'Label' })).toBeInTheDocument();
    const personal = screen.getByRole('radio', { name: 'Personal' });
    const label = screen.getByRole('radio', { name: 'Etsy shop' });
    expect(personal).toBeChecked();
    expect(label).not.toBeChecked();

    await user.click(label);
    expect(onChange).toHaveBeenLastCalledWith('l1');
  });

  it('paints the selected label segment in the label color, not the Personal one', () => {
    renderPicker({ labels: [etsy], value: 'l1' });
    const labelSegment = screen.getByRole('radio', { name: 'Etsy shop' }).closest('label');
    const personalSegment = screen.getByRole('radio', { name: 'Personal' }).closest('label');
    expect(labelSegment).toHaveStyle({ backgroundColor: etsy.color });
    expect(labelSegment).not.toHaveClass('btn-primary');
    expect(personalSegment).not.toHaveStyle({ backgroundColor: etsy.color });
  });

  it('shows a color dot on the label segment when it is not selected', () => {
    renderPicker({ labels: [etsy], value: null });
    const labelSegment = screen.getByRole('radio', { name: 'Etsy shop' }).closest('label');
    expect(labelSegment).not.toHaveStyle({ backgroundColor: etsy.color });
    expect(labelSegment?.querySelector('[aria-hidden="true"]')).toHaveStyle({
      backgroundColor: etsy.color,
    });
  });

  it('reports null when Personal is clicked in the radio group', async () => {
    const user = userEvent.setup();
    const { onChange } = renderPicker({ labels: [etsy], value: 'l1' });

    expect(screen.getByRole('radio', { name: 'Etsy shop' })).toBeChecked();
    await user.click(screen.getByRole('radio', { name: 'Personal' }));
    expect(onChange).toHaveBeenLastCalledWith(null);
  });

  it('renders a select with Personal first when there are two labels', async () => {
    const user = userEvent.setup();
    const { onChange } = renderPicker({ labels: [consulting, etsy] });

    const select = screen.getByLabelText('Label');
    expect(select.tagName).toBe('SELECT');
    expect(screen.queryByRole('radiogroup')).not.toBeInTheDocument();
    const options = screen.getAllByRole('option');
    expect(options.map((o) => o.textContent)).toEqual([
      'Personal',
      'Consulting',
      'Etsy shop',
    ]);

    await user.selectOptions(select, 'l1');
    expect(onChange).toHaveBeenLastCalledWith('l1');
  });

  it('reports null when Personal is picked in the select', async () => {
    const user = userEvent.setup();
    const { onChange } = renderPicker({
      labels: [consulting, etsy],
      value: 'l2',
    });

    expect(screen.getByLabelText('Label')).toHaveValue('l2');
    await user.selectOptions(screen.getByLabelText('Label'), '');
    expect(onChange).toHaveBeenLastCalledWith(null);
  });

  it('hides an archived label that is not the current value', () => {
    renderPicker({ labels: [consulting, etsy, oldShop], value: null });
    expect(
      screen.queryByRole('option', { name: /Old shop/ }),
    ).not.toBeInTheDocument();
  });

  it('shows the archived label with a suffix when it is the current value', () => {
    renderPicker({ labels: [etsy, oldShop], value: 'l3' });
    const select = screen.getByLabelText('Label');
    expect(select).toHaveValue('l3');
    expect(
      screen.getByRole('option', { name: 'Old shop (archived)' }),
    ).toBeInTheDocument();
  });

  it('shows the archived label with a suffix in the radio layout too', () => {
    renderPicker({ labels: [oldShop], value: 'l3' });
    const radio = screen.getByRole('radio', { name: 'Old shop (archived)' });
    expect(radio).toBeChecked();
  });

  it('creates a label from the inline row and selects it', async () => {
    const created = makeLabel({ _id: 'l9', name: 'Bakery', color: '#112233' });
    vi.mocked(createLabel).mockResolvedValue(created);
    const user = userEvent.setup();
    const { onChange, onCreated } = renderPicker({ labels: [etsy] });

    await user.click(screen.getByRole('button', { name: 'Add a label' }));
    const color = screen.getByLabelText('New label color');
    expect(color).toHaveValue(defaultLabelColor(1));
    await user.type(screen.getByLabelText('New label name'), '  Bakery  ');
    fireEvent.input(color, { target: { value: '#112233' } });
    await user.click(screen.getByRole('button', { name: 'Add new label' }));

    await waitFor(() =>
      expect(createLabel).toHaveBeenCalledWith({
        name: 'Bakery',
        color: '#112233',
      }),
    );
    expect(onCreated).toHaveBeenCalledWith(created);
    expect(onChange).toHaveBeenLastCalledWith('l9');
    await waitFor(() =>
      expect(screen.queryByLabelText('New label name')).not.toBeInTheDocument(),
    );
    expect(screen.getByRole('button', { name: 'Add a label' })).toBeInTheDocument();
  });

  it('submits the inline row on Enter without submitting the outer form', async () => {
    const created = makeLabel({ _id: 'l9', name: 'Biz' });
    vi.mocked(createLabel).mockResolvedValue(created);
    const outerSubmit = vi.fn((e: React.FormEvent) => e.preventDefault());
    const onChange = vi.fn();
    const user = userEvent.setup();

    render(
      <form onSubmit={outerSubmit}>
        <LabelPicker
          id="txn-label"
          labels={[]}
          value={null}
          onChange={onChange}
          onCreated={vi.fn()}
        />
      </form>,
    );

    await user.click(screen.getByRole('button', { name: 'Add a label' }));
    await user.type(screen.getByLabelText('New label name'), 'Biz{enter}');

    await waitFor(() =>
      expect(createLabel).toHaveBeenCalledWith({
        name: 'Biz',
        color: defaultLabelColor(0),
      }),
    );
    expect(onChange).toHaveBeenLastCalledWith('l9');
    expect(outerSubmit).not.toHaveBeenCalled();
  });

  it('does not call createLabel for a blank name', async () => {
    const user = userEvent.setup();
    renderPicker();

    await user.click(screen.getByRole('button', { name: 'Add a label' }));
    await user.type(screen.getByLabelText('New label name'), '   ');
    await user.click(screen.getByRole('button', { name: 'Add new label' }));

    expect(createLabel).not.toHaveBeenCalled();
    expect(screen.getByLabelText('New label name')).toBeInTheDocument();
  });

  it('closes the inline row on Cancel without creating anything', async () => {
    const user = userEvent.setup();
    renderPicker();

    await user.click(screen.getByRole('button', { name: 'Add a label' }));
    await user.type(screen.getByLabelText('New label name'), 'Draft');
    await user.click(screen.getByRole('button', { name: 'Cancel new label' }));

    expect(screen.queryByLabelText('New label name')).not.toBeInTheDocument();
    expect(createLabel).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Add a label' }));
    expect(screen.getByLabelText('New label name')).toHaveValue('');
  });

  it('shows an inline error and a toast when createLabel rejects', async () => {
    vi.mocked(createLabel).mockRejectedValue(
      new Error('A label named "Etsy shop" already exists'),
    );
    const user = userEvent.setup();
    const { onChange, onCreated } = renderPicker({ labels: [etsy] });

    await user.click(screen.getByRole('button', { name: 'Add a label' }));
    await user.type(screen.getByLabelText('New label name'), 'Etsy shop');
    await user.click(screen.getByRole('button', { name: 'Add new label' }));

    expect(
      await screen.findByText('A label named "Etsy shop" already exists'),
    ).toBeInTheDocument();
    expect(showErrorToast).toHaveBeenCalledWith(
      'A label named "Etsy shop" already exists',
    );
    expect(onCreated).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
    // The row stays open so the user can fix the name.
    expect(screen.getByLabelText('New label name')).toHaveValue('Etsy shop');
  });

  it('disables the radios and the add button when disabled', () => {
    renderPicker({ labels: [etsy], disabled: true });
    for (const radio of screen.getAllByRole('radio')) {
      expect(radio).toBeDisabled();
    }
    expect(screen.getByRole('button', { name: 'Add a label' })).toBeDisabled();
  });

  it('disables the select when disabled', () => {
    renderPicker({ labels: [consulting, etsy], disabled: true });
    expect(screen.getByLabelText('Label')).toBeDisabled();
  });

  it('reports a create that resolves after Cancel without selecting it', async () => {
    let resolve!: (label: Label) => void;
    vi.mocked(createLabel).mockReturnValue(
      new Promise<Label>((r) => {
        resolve = r;
      }),
    );
    const user = userEvent.setup();
    const { onChange, onCreated } = renderPicker({ labels: [etsy] });

    await user.click(screen.getByRole('button', { name: 'Add a label' }));
    await user.type(screen.getByLabelText('New label name'), 'Bakery');
    await user.click(screen.getByRole('button', { name: 'Add new label' }));
    await user.click(screen.getByRole('button', { name: 'Cancel new label' }));
    const created = makeLabel({ _id: 'l9', name: 'Bakery' });
    await act(async () => {
      resolve(created);
    });

    expect(createLabel).toHaveBeenCalledTimes(1);
    // The label exists on the server, so the parent's list must include it.
    expect(onCreated).toHaveBeenCalledTimes(1);
    expect(onCreated).toHaveBeenCalledWith(created);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('keeps Add disabled after Cancel until the pending create settles', async () => {
    let resolve!: (label: Label) => void;
    vi.mocked(createLabel).mockReturnValue(
      new Promise<Label>((r) => {
        resolve = r;
      }),
    );
    const user = userEvent.setup();
    renderPicker({ labels: [etsy] });

    await user.click(screen.getByRole('button', { name: 'Add a label' }));
    await user.type(screen.getByLabelText('New label name'), 'Bakery');
    await user.click(screen.getByRole('button', { name: 'Add new label' }));
    await user.click(screen.getByRole('button', { name: 'Cancel new label' }));
    await user.click(screen.getByRole('button', { name: 'Add a label' }));

    // A retry now would create a duplicate while the first request is pending.
    expect(screen.getByRole('button', { name: 'Add new label' })).toBeDisabled();

    await act(async () => {
      resolve(makeLabel({ _id: 'l9', name: 'Bakery' }));
    });

    expect(screen.getByRole('button', { name: 'Add new label' })).toBeEnabled();
    expect(createLabel).toHaveBeenCalledTimes(1);
  });

  it('rejects the reserved name Personal in any case', async () => {
    const user = userEvent.setup();
    const { onChange, onCreated } = renderPicker({ labels: [etsy] });

    await user.click(screen.getByRole('button', { name: 'Add a label' }));
    await user.type(screen.getByLabelText('New label name'), '  personal ');
    await user.click(screen.getByRole('button', { name: 'Add new label' }));

    expect(
      screen.getByText('"Personal" is the built-in default and cannot be a label name'),
    ).toBeInTheDocument();
    expect(createLabel).not.toHaveBeenCalled();
    expect(onCreated).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('keeps an archived saved label listed after switching to another label', () => {
    const props = {
      id: 'txn-label',
      labels: [etsy, oldShop],
      onChange: vi.fn(),
      onCreated: vi.fn(),
    };
    const { rerender } = render(<LabelPicker {...props} value="l3" />);
    expect(screen.getByLabelText('Label').tagName).toBe('SELECT');

    rerender(<LabelPicker {...props} value="l1" />);

    const select = screen.getByLabelText('Label');
    expect(select.tagName).toBe('SELECT');
    expect(select).toHaveValue('l1');
    expect(
      screen.getByRole('option', { name: 'Old shop (archived)' }),
    ).toBeInTheDocument();
  });

  it('shows a disabled placeholder for a saved label missing from the list', async () => {
    const user = userEvent.setup();
    const { onChange } = renderPicker({ labels: [], value: 'x' });

    const select = screen.getByLabelText('Label');
    expect(select.tagName).toBe('SELECT');
    expect(select).toHaveValue('x');
    const placeholder = screen.getByRole('option', {
      name: 'Current label (unavailable)',
    });
    expect(placeholder).toBeDisabled();
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual([
      'Personal',
      'Current label (unavailable)',
    ]);

    await user.selectOptions(select, '');
    expect(onChange).toHaveBeenLastCalledWith(null);
  });

  it('ignores Enter while an IME composition is active', async () => {
    const user = userEvent.setup();
    renderPicker();

    await user.click(screen.getByRole('button', { name: 'Add a label' }));
    const input = screen.getByLabelText('New label name');
    await user.type(input, 'Biz');
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true });

    expect(createLabel).not.toHaveBeenCalled();
    expect(input).toBeInTheDocument();
  });

  it('uses native radio inputs that share a group name', async () => {
    const user = userEvent.setup();
    const { onChange } = renderPicker({ labels: [etsy], value: null });

    const personal = screen.getByRole('radio', { name: 'Personal' });
    const label = screen.getByRole('radio', { name: 'Etsy shop' });
    expect(personal).toHaveAttribute('type', 'radio');
    expect(label).toHaveAttribute('type', 'radio');
    expect(label.getAttribute('name')).toBe(personal.getAttribute('name'));

    // Arrow keys move the selection, which buttons with role="radio" do not.
    personal.focus();
    await user.keyboard('{ArrowRight}');
    expect(onChange).toHaveBeenLastCalledWith('l1');
  });
});
