import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('@/lib/accounts', () => ({
  createAccount: vi.fn(),
  updateAccount: vi.fn(),
}));
vi.mock('@/lib/toast', () => ({
  showErrorToast: vi.fn(),
  showSuccessToast: vi.fn(),
}));

import { createAccount, updateAccount } from '@/lib/accounts';
import { showErrorToast, showSuccessToast } from '@/lib/toast';
import AccountForm from '@/components/AccountForm';
import type { Account } from '@/lib/types';

const account: Account = {
  _id: 'a1',
  householdId: 'h1',
  name: 'Checking',
  type: 'checking',
  balanceCents: 5000,
  isArchived: false,
  createdAt: '',
  updatedAt: '',
};

describe('AccountForm', () => {
  afterEach(() => vi.clearAllMocks());

  it('creates an account with an opening balance in cents', async () => {
    const user = userEvent.setup();
    vi.mocked(createAccount).mockResolvedValue(account);
    const onSaved = vi.fn();

    render(<AccountForm onSaved={onSaved} onCancel={vi.fn()} />);
    await user.type(screen.getByLabelText('Name'), 'Savings');
    await user.selectOptions(screen.getByLabelText('Type'), 'savings');
    await user.type(screen.getByLabelText('Opening balance ($)'), '100.50');
    await user.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() =>
      expect(createAccount).toHaveBeenCalledWith({
        name: 'Savings',
        type: 'savings',
        balanceCents: 10050,
      }),
    );
    expect(showSuccessToast).toHaveBeenCalledWith('Account created');
    expect(onSaved).toHaveBeenCalled();
  });

  it('stores a credit account opening balance as negative', async () => {
    const user = userEvent.setup();
    vi.mocked(createAccount).mockResolvedValue(account);

    render(<AccountForm onSaved={vi.fn()} onCancel={vi.fn()} />);
    await user.type(screen.getByLabelText('Name'), 'Visa');
    await user.selectOptions(screen.getByLabelText('Type'), 'credit');
    await user.type(screen.getByLabelText('Opening balance ($)'), '300');
    await user.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() =>
      expect(createAccount).toHaveBeenCalledWith(
        expect.objectContaining({ balanceCents: -30000 }),
      ),
    );
  });

  it('updates an existing account (no opening-balance field)', async () => {
    const user = userEvent.setup();
    vi.mocked(updateAccount).mockResolvedValue(account);

    render(<AccountForm account={account} onSaved={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByLabelText('Name')).toHaveValue('Checking');
    expect(screen.queryByLabelText('Opening balance ($)')).toBeNull();

    await user.clear(screen.getByLabelText('Name'));
    await user.type(screen.getByLabelText('Name'), 'Main');
    await user.click(screen.getByRole('button', { name: 'Update' }));

    await waitFor(() =>
      expect(updateAccount).toHaveBeenCalledWith('a1', {
        name: 'Main',
        type: 'checking',
      }),
    );
  });

  it('shows the toast when the API rejects', async () => {
    const user = userEvent.setup();
    vi.mocked(createAccount).mockRejectedValue(new Error('Server error'));

    render(<AccountForm onSaved={vi.fn()} onCancel={vi.fn()} />);
    await user.type(screen.getByLabelText('Name'), 'X');
    await user.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() =>
      expect(showErrorToast).toHaveBeenCalledWith('Server error'),
    );
    expect(screen.getByText('Server error')).toBeInTheDocument();
  });
});
