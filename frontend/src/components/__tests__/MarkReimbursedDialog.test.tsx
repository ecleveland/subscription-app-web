import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('@/lib/transactions', () => ({ listTransactions: vi.fn() }));
vi.mock('@/lib/toast', () => ({
  showErrorToast: vi.fn(),
  showSuccessToast: vi.fn(),
}));

import { listTransactions } from '@/lib/transactions';
import { showErrorToast } from '@/lib/toast';
import MarkReimbursedDialog from '../MarkReimbursedDialog';
import type { Transaction } from '@/lib/types';

// jsdom has no modal dialog. Toggling the open attribute keeps the dialog's
// contents in the accessibility tree the way a browser would.
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
  });
  HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
    this.removeAttribute('open');
  });
});

function income(overrides: Partial<Transaction>): Transaction {
  return {
    _id: 'i1',
    householdId: 'h',
    accountId: 'a1',
    type: 'income',
    amountCents: 5500,
    date: '2026-11-10T12:00:00.000Z',
    payee: 'Client A',
    cleared: true,
    createdAt: '',
    updatedAt: '',
    ...overrides,
  };
}

const incomes = [
  income({ _id: 'i1', payee: 'Client A', amountCents: 5500 }),
  income({ _id: 'i2', payee: 'Payroll', amountCents: 250000 }),
];

const today = new Date().toISOString().slice(0, 10);

function renderDialog(props: Partial<Parameters<typeof MarkReimbursedDialog>[0]> = {}) {
  const onConfirm = vi.fn();
  const onCancel = vi.fn();
  const utils = render(
    <MarkReimbursedDialog
      open
      count={2}
      onConfirm={onConfirm}
      onCancel={onCancel}
      {...props}
    />,
  );
  return { ...utils, onConfirm, onCancel };
}

describe('MarkReimbursedDialog', () => {
  beforeEach(() => {
    vi.mocked(listTransactions).mockResolvedValue({
      data: incomes,
      meta: { total: 2, page: 1, limit: 20, totalPages: 1, hasNextPage: false },
    });
  });
  afterEach(() => vi.clearAllMocks());

  it('names the count and defaults the date to today', async () => {
    renderDialog();
    const dialog = screen.getByRole('dialog', { name: 'Mark 2 expenses reimbursed' });
    expect(within(dialog).getByLabelText('Reimbursed on')).toHaveValue(today);
    await within(dialog).findByRole('radio', { name: /Client A/ });
  });

  it('uses the singular for one expense', async () => {
    renderDialog({ count: 1 });
    expect(
      screen.getByRole('dialog', { name: 'Mark 1 expense reimbursed' }),
    ).toBeInTheDocument();
    await screen.findByRole('radio', { name: /Client A/ });
  });

  it('loads the 20 most recent income transactions when opened', async () => {
    renderDialog();
    await screen.findByRole('radio', { name: /Client A/ });
    expect(listTransactions).toHaveBeenCalledWith({ type: 'income', limit: 20 });
  });

  it('does not load income while closed', () => {
    renderDialog({ open: false });
    expect(listTransactions).not.toHaveBeenCalled();
  });

  it('lists no linked income first and checked', async () => {
    renderDialog();
    await screen.findByRole('radio', { name: /Client A/ });
    const radios = screen.getAllByRole('radio');
    expect(radios[0]).toHaveAccessibleName('No linked income');
    expect(radios[0]).toBeChecked();
    expect(radios).toHaveLength(3);
  });

  it('filters income by payee, ignoring case', async () => {
    const user = userEvent.setup();
    renderDialog();
    await screen.findByRole('radio', { name: /Client A/ });

    await user.type(screen.getByLabelText('Search income'), 'payr');

    expect(screen.queryByRole('radio', { name: /Client A/ })).not.toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Payroll/ })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'No linked income' })).toBeInTheDocument();
  });

  it('filters income by amount', async () => {
    const user = userEvent.setup();
    renderDialog();
    await screen.findByRole('radio', { name: /Client A/ });

    await user.type(screen.getByLabelText('Search income'), '55.00');

    expect(screen.getByRole('radio', { name: /Client A/ })).toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: /Payroll/ })).not.toBeInTheDocument();
  });

  it('confirms with the date and no link by default', async () => {
    const user = userEvent.setup();
    const { onConfirm } = renderDialog();
    await screen.findByRole('radio', { name: /Client A/ });

    await user.click(screen.getByRole('button', { name: 'Mark reimbursed' }));

    expect(onConfirm).toHaveBeenCalledWith({ reimbursedAt: today });
  });

  it('confirms with the chosen date and the picked income', async () => {
    const user = userEvent.setup();
    const { onConfirm } = renderDialog();
    await user.click(await screen.findByRole('radio', { name: /Client A/ }));
    const date = screen.getByLabelText('Reimbursed on');
    await user.clear(date);
    await user.type(date, '2026-11-12');

    await user.click(screen.getByRole('button', { name: 'Mark reimbursed' }));

    expect(onConfirm).toHaveBeenCalledWith({
      reimbursedAt: '2026-11-12',
      reimbursedByTransactionId: 'i1',
    });
  });

  it('disables confirm when the date is empty', async () => {
    const user = userEvent.setup();
    renderDialog();
    await screen.findByRole('radio', { name: /Client A/ });

    await user.clear(screen.getByLabelText('Reimbursed on'));

    expect(screen.getByRole('button', { name: 'Mark reimbursed' })).toBeDisabled();
  });

  it('disables confirm while the save is in flight', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn(() => new Promise<void>(() => {}));
    renderDialog({ onConfirm });
    await screen.findByRole('radio', { name: /Client A/ });

    await user.click(screen.getByRole('button', { name: 'Mark reimbursed' }));

    expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled();
  });

  it('cancels', async () => {
    const user = userEvent.setup();
    const { onCancel, onConfirm } = renderDialog();
    await screen.findByRole('radio', { name: /Client A/ });

    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onCancel).toHaveBeenCalled();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('shows a load error inline and in a toast, and still confirms without a link', async () => {
    vi.mocked(listTransactions).mockRejectedValue(new Error('Income down'));
    const user = userEvent.setup();
    const { onConfirm } = renderDialog();

    expect(await screen.findByText('Income down')).toBeInTheDocument();
    expect(showErrorToast).toHaveBeenCalledWith('Income down');

    await user.click(screen.getByRole('button', { name: 'Mark reimbursed' }));
    await waitFor(() =>
      expect(onConfirm).toHaveBeenCalledWith({ reimbursedAt: today }),
    );
  });

  it('starts fresh each time it opens', async () => {
    const user = userEvent.setup();
    const { rerender, onConfirm, onCancel } = renderDialog();
    await user.click(await screen.findByRole('radio', { name: /Client A/ }));

    rerender(
      <MarkReimbursedDialog open={false} count={2} onConfirm={onConfirm} onCancel={onCancel} />,
    );
    rerender(
      <MarkReimbursedDialog open count={2} onConfirm={onConfirm} onCancel={onCancel} />,
    );

    await screen.findByRole('radio', { name: /Client A/ });
    expect(screen.getByRole('radio', { name: 'No linked income' })).toBeChecked();
    expect(listTransactions).toHaveBeenCalledTimes(2);
  });
});
