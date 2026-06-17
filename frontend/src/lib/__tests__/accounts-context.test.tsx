import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

let authState: { isAuthenticated: boolean };
vi.mock('../auth-context', () => ({ useAuth: () => authState }));
vi.mock('../accounts', () => ({ listAccounts: vi.fn() }));

import { listAccounts } from '../accounts';
import { AccountsProvider, useAccounts } from '../accounts-context';
import type { Account } from '../types';

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

function Consumer() {
  const { accounts, loading, error, refresh } = useAccounts();
  return (
    <div>
      <span>loading:{String(loading)}</span>
      <span>count:{accounts.length}</span>
      <span>error:{error ?? 'none'}</span>
      <button onClick={() => refresh()}>refresh</button>
    </div>
  );
}

describe('AccountsContext', () => {
  afterEach(() => vi.clearAllMocks());

  it('loads accounts when authenticated', async () => {
    authState = { isAuthenticated: true };
    vi.mocked(listAccounts).mockResolvedValue([account]);

    render(
      <AccountsProvider>
        <Consumer />
      </AccountsProvider>,
    );

    await waitFor(() => expect(screen.getByText('count:1')).toBeInTheDocument());
    expect(screen.getByText('loading:false')).toBeInTheDocument();
  });

  it('stays empty and does not fetch when unauthenticated', async () => {
    authState = { isAuthenticated: false };

    render(
      <AccountsProvider>
        <Consumer />
      </AccountsProvider>,
    );

    await waitFor(() => expect(screen.getByText('count:0')).toBeInTheDocument());
    expect(listAccounts).not.toHaveBeenCalled();
  });

  it('refresh re-fetches', async () => {
    authState = { isAuthenticated: true };
    vi.mocked(listAccounts).mockResolvedValue([account]);

    render(
      <AccountsProvider>
        <Consumer />
      </AccountsProvider>,
    );
    await waitFor(() => expect(screen.getByText('count:1')).toBeInTheDocument());

    await userEvent.click(screen.getByText('refresh'));
    await waitFor(() => expect(listAccounts).toHaveBeenCalledTimes(2));
  });

  it('keeps last-known accounts and records the error on a failed refresh', async () => {
    authState = { isAuthenticated: true };
    vi.mocked(listAccounts).mockResolvedValueOnce([account]);

    render(
      <AccountsProvider>
        <Consumer />
      </AccountsProvider>,
    );
    await waitFor(() => expect(screen.getByText('count:1')).toBeInTheDocument());

    vi.mocked(listAccounts).mockRejectedValueOnce(new Error('network down'));
    await userEvent.click(screen.getByText('refresh'));

    await waitFor(() =>
      expect(screen.getByText('error:network down')).toBeInTheDocument(),
    );
    // Last-known accounts retained.
    expect(screen.getByText('count:1')).toBeInTheDocument();
  });
});
