import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

let accountsState: {
  accounts: unknown[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
};
vi.mock('@/lib/accounts-context', () => ({ useAccounts: () => accountsState }));
vi.mock('@/lib/accounts', () => ({ archiveAccount: vi.fn() }));
vi.mock('@/lib/toast', () => ({
  showErrorToast: vi.fn(),
  showSuccessToast: vi.fn(),
}));
vi.mock('@/components/AccountForm', () => ({
  default: () => <div>AccountFormStub</div>,
}));

import { archiveAccount } from '@/lib/accounts';
import { showSuccessToast } from '@/lib/toast';
import AccountsPage from '@/app/accounts/page';
import type { Account } from '@/lib/types';

const account: Account = {
  _id: 'a1',
  householdId: 'h',
  name: 'Checking',
  type: 'checking',
  balanceCents: 12345,
  isArchived: false,
  createdAt: '',
  updatedAt: '',
};

describe('AccountsPage', () => {
  beforeAll(() => {
    HTMLDialogElement.prototype.showModal = vi.fn();
    HTMLDialogElement.prototype.close = vi.fn();
  });
  afterEach(() => vi.clearAllMocks());

  it('shows the loading state', () => {
    accountsState = { accounts: [], loading: true, error: null, refresh: vi.fn() };
    render(<AccountsPage />);
    expect(screen.getByText('Loading accounts…')).toBeInTheDocument();
  });

  it('renders accounts with formatted balances', () => {
    accountsState = { accounts: [account], loading: false, error: null, refresh: vi.fn() };
    render(<AccountsPage />);
    expect(screen.getByText('Checking')).toBeInTheDocument();
    expect(screen.getByText('$123.45')).toBeInTheDocument();
  });

  it('shows the empty state', () => {
    accountsState = { accounts: [], loading: false, error: null, refresh: vi.fn() };
    render(<AccountsPage />);
    expect(
      screen.getByText(/No accounts yet/),
    ).toBeInTheDocument();
  });

  it('archives an account through the confirm dialog', async () => {
    const refresh = vi.fn().mockResolvedValue(undefined);
    accountsState = { accounts: [account], loading: false, error: null, refresh };
    vi.mocked(archiveAccount).mockResolvedValue(undefined);
    const user = userEvent.setup();

    render(<AccountsPage />);
    // Row archive button opens the confirm dialog.
    await user.click(screen.getByRole('button', { name: 'Archive' }));
    // The dialog adds a second "Archive" button (the confirm, hidden in jsdom);
    // click it.
    await user.click(
      screen.getAllByRole('button', { name: 'Archive', hidden: true }).at(-1)!,
    );

    await waitFor(() => expect(archiveAccount).toHaveBeenCalledWith('a1'));
    expect(showSuccessToast).toHaveBeenCalledWith('Account archived');
    expect(refresh).toHaveBeenCalled();
  });
});
