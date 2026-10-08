import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SubscriptionForm from '../SubscriptionForm';
import type { Account, Subscription } from '@/lib/types';

vi.mock('@/lib/api', () => ({
  apiFetch: vi.fn(),
}));

vi.mock('@/lib/toast', () => ({
  showErrorToast: vi.fn(),
  showSuccessToast: vi.fn(),
}));

const ledgerAccounts: Account[] = [
  {
    _id: 'acc-1',
    householdId: 'hh-1',
    name: 'Checking',
    type: 'checking',
    balanceCents: 0,
    isArchived: false,
    createdAt: '2025-01-01',
    updatedAt: '2025-01-01',
  },
  {
    _id: 'acc-2',
    householdId: 'hh-1',
    name: 'Visa',
    type: 'credit',
    balanceCents: 0,
    isArchived: false,
    createdAt: '2025-01-01',
    updatedAt: '2025-01-01',
  },
];

const accountsState = {
  accounts: ledgerAccounts,
  loading: false,
  error: null as string | null,
  refresh: vi.fn(),
};

vi.mock('@/lib/accounts-context', () => ({
  useAccounts: () => accountsState,
}));

const mockPush = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
    replace: vi.fn(),
    back: vi.fn(),
    prefetch: vi.fn(),
  }),
  useParams: () => ({}),
  useSearchParams: () => new URLSearchParams(),
}));

import { apiFetch } from '@/lib/api';
import { showErrorToast, showSuccessToast } from '@/lib/toast';

const existingSub: Subscription = {
  _id: 'sub-1',
  userId: 'u1',
  name: 'Netflix',
  cost: 15.99,
  billingCycle: 'monthly',
  nextBillingDate: '2025-06-15T00:00:00.000Z',
  category: 'Streaming',
  notes: 'Family plan',
  tags: ['shared', 'essential'],
  isActive: true,
  reminderDaysBefore: 3,
  createdAt: '2025-01-01',
  updatedAt: '2025-01-01',
};

describe('SubscriptionForm', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    mockPush.mockClear();
  });

  describe('create mode', () => {
    it('should render empty form with Create button', () => {
      render(<SubscriptionForm />);

      expect(screen.getByLabelText('Name')).toHaveValue('');
      expect(screen.getByLabelText('Cost ($)')).toHaveValue(null);
      expect(screen.getByRole('button', { name: 'Create' })).toBeInTheDocument();
    });

    it('should include weekly in billing cycle options', () => {
      render(<SubscriptionForm />);
      const select = screen.getByLabelText('Billing Cycle');
      const options = select.querySelectorAll('option');
      const values = Array.from(options).map((o) => o.getAttribute('value'));
      expect(values).toContain('weekly');
    });

    it('should not show Delete button', () => {
      render(<SubscriptionForm />);
      expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();
    });

    it('should submit POST and navigate on success', async () => {
      const user = userEvent.setup();
      vi.mocked(apiFetch).mockResolvedValueOnce({});

      render(<SubscriptionForm />);

      await user.type(screen.getByLabelText('Name'), 'Spotify');
      await user.type(screen.getByLabelText('Cost ($)'), '9.99');
      await user.type(screen.getByLabelText('Next Billing Date'), '2025-07-01');

      await user.click(screen.getByRole('button', { name: 'Create' }));

      await waitFor(() => {
        expect(apiFetch).toHaveBeenCalledWith('/subscriptions', {
          method: 'POST',
          body: expect.stringContaining('"name":"Spotify"'),
        });
      });

      await waitFor(() => {
        expect(mockPush).toHaveBeenCalledWith('/');
        expect(showSuccessToast).toHaveBeenCalledWith('Subscription created');
      });
    });

    it('should display error on API failure', async () => {
      const user = userEvent.setup();
      vi.mocked(apiFetch).mockRejectedValueOnce(new Error('Server error'));

      render(<SubscriptionForm />);

      await user.type(screen.getByLabelText('Name'), 'Test');
      await user.type(screen.getByLabelText('Cost ($)'), '5');
      await user.type(screen.getByLabelText('Next Billing Date'), '2025-07-01');

      await user.click(screen.getByRole('button', { name: 'Create' }));

      await waitFor(() => {
        expect(screen.getByText('Server error')).toBeInTheDocument();
        expect(showErrorToast).toHaveBeenCalledWith('Server error');
      });
    });
  });

  describe('edit mode', () => {
    it('should pre-fill fields from subscription prop', () => {
      render(<SubscriptionForm subscription={existingSub} />);

      expect(screen.getByLabelText('Name')).toHaveValue('Netflix');
      expect(screen.getByLabelText('Cost ($)')).toHaveValue(15.99);
      expect(screen.getByLabelText('Notes (optional)')).toHaveValue('Family plan');
      expect(screen.getByText('shared')).toBeInTheDocument();
      expect(screen.getByText('essential')).toBeInTheDocument();
    });

    it('should show Update button', () => {
      render(<SubscriptionForm subscription={existingSub} />);
      expect(screen.getByRole('button', { name: 'Update' })).toBeInTheDocument();
    });

    it('should show Delete button', () => {
      render(<SubscriptionForm subscription={existingSub} />);
      expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument();
    });

    it('should submit PATCH on update', async () => {
      const user = userEvent.setup();
      vi.mocked(apiFetch).mockResolvedValueOnce({});

      render(<SubscriptionForm subscription={existingSub} />);

      await user.clear(screen.getByLabelText('Name'));
      await user.type(screen.getByLabelText('Name'), 'Netflix Premium');
      await user.click(screen.getByRole('button', { name: 'Update' }));

      await waitFor(() => {
        expect(apiFetch).toHaveBeenCalledWith('/subscriptions/sub-1', {
          method: 'PATCH',
          body: expect.stringContaining('"name":"Netflix Premium"'),
        });
      });
    });

    it('should include tags in submit body', async () => {
      const user = userEvent.setup();
      vi.mocked(apiFetch).mockReset();
      vi.mocked(apiFetch).mockResolvedValueOnce({});

      render(<SubscriptionForm subscription={existingSub} />);
      await user.click(screen.getByRole('button', { name: 'Update' }));

      await waitFor(() => {
        expect(apiFetch).toHaveBeenCalled();
        const body = JSON.parse(
          vi.mocked(apiFetch).mock.calls[0][1]!.body as string,
        );
        expect(body.tags).toEqual(['shared', 'essential']);
      });
    });

    it('should call DELETE on delete with confirm', async () => {
      const user = userEvent.setup();
      vi.spyOn(window, 'confirm').mockReturnValue(true);
      vi.mocked(apiFetch).mockResolvedValueOnce(undefined);

      render(<SubscriptionForm subscription={existingSub} />);

      await user.click(screen.getByRole('button', { name: 'Delete' }));

      await waitFor(() => {
        expect(apiFetch).toHaveBeenCalledWith('/subscriptions/sub-1', {
          method: 'DELETE',
        });
      });
    });

    it('should not delete when confirm is cancelled', async () => {
      const user = userEvent.setup();
      vi.spyOn(window, 'confirm').mockReturnValue(false);
      vi.mocked(apiFetch).mockClear();

      render(<SubscriptionForm subscription={existingSub} />);

      await user.click(screen.getByRole('button', { name: 'Delete' }));

      expect(apiFetch).not.toHaveBeenCalled();
    });
  });

  describe('trial tracking', () => {
    it('should hide trial date input by default', () => {
      render(<SubscriptionForm />);
      expect(screen.queryByLabelText('Trial End Date')).not.toBeInTheDocument();
    });

    it('should show trial date input when checkbox is checked', async () => {
      const user = userEvent.setup();
      render(<SubscriptionForm />);

      await user.click(screen.getByLabelText('Has free trial'));
      expect(screen.getByLabelText('Trial End Date')).toBeInTheDocument();
    });

    it('should pre-fill trial fields in edit mode when subscription has trialEndDate', () => {
      render(
        <SubscriptionForm
          subscription={{ ...existingSub, trialEndDate: '2025-07-15T00:00:00.000Z' }}
        />,
      );
      expect(screen.getByLabelText('Has free trial')).toBeChecked();
      expect(screen.getByLabelText('Trial End Date')).toHaveValue('2025-07-15');
    });

    it('should include trialEndDate in submit when enabled', async () => {
      const user = userEvent.setup();
      vi.mocked(apiFetch).mockResolvedValueOnce({});

      render(<SubscriptionForm />);

      await user.type(screen.getByLabelText('Name'), 'Test');
      await user.type(screen.getByLabelText('Cost ($)'), '5');
      await user.type(screen.getByLabelText('Next Billing Date'), '2025-07-01');
      await user.click(screen.getByLabelText('Has free trial'));
      await user.type(screen.getByLabelText('Trial End Date'), '2025-08-01');
      await user.click(screen.getByRole('button', { name: 'Create' }));

      await waitFor(() => {
        expect(apiFetch).toHaveBeenCalled();
        const body = JSON.parse(
          vi.mocked(apiFetch).mock.calls[0][1]!.body as string,
        );
        expect(body.trialEndDate).toBe('2025-08-01');
      });
    });

    it('should send null trialEndDate when toggle unchecked in edit mode', async () => {
      const user = userEvent.setup();
      vi.mocked(apiFetch).mockReset();
      vi.mocked(apiFetch).mockResolvedValueOnce({});

      render(
        <SubscriptionForm
          subscription={{ ...existingSub, trialEndDate: '2025-07-15T00:00:00.000Z' }}
        />,
      );

      // Uncheck the trial checkbox
      await user.click(screen.getByLabelText('Has free trial'));
      await user.click(screen.getByRole('button', { name: 'Update' }));

      await waitFor(() => {
        expect(apiFetch).toHaveBeenCalled();
        const body = JSON.parse(
          vi.mocked(apiFetch).mock.calls[0][1]!.body as string,
        );
        expect(body.trialEndDate).toBeNull();
      });
    });
  });

  describe('shared subscription', () => {
    it('should hide shared input by default', () => {
      render(<SubscriptionForm />);
      expect(screen.queryByLabelText(/Number of people sharing/)).not.toBeInTheDocument();
    });

    it('should show shared input when checkbox is checked', async () => {
      const user = userEvent.setup();
      render(<SubscriptionForm />);

      await user.click(screen.getByLabelText('Shared subscription'));
      expect(screen.getByLabelText(/Number of people sharing/)).toBeInTheDocument();
    });

    it('should pre-fill shared fields in edit mode', () => {
      render(
        <SubscriptionForm
          subscription={{ ...existingSub, sharedWith: 4 }}
        />,
      );
      expect(screen.getByLabelText('Shared subscription')).toBeChecked();
      expect(screen.getByLabelText(/Number of people sharing/)).toHaveValue(4);
    });

    it('should include sharedWith in submit when enabled', async () => {
      const user = userEvent.setup();
      vi.mocked(apiFetch).mockReset();
      vi.mocked(apiFetch).mockResolvedValueOnce({});

      render(
        <SubscriptionForm
          subscription={{ ...existingSub, sharedWith: 3 }}
        />,
      );

      await user.click(screen.getByRole('button', { name: 'Update' }));

      await waitFor(() => {
        expect(apiFetch).toHaveBeenCalled();
        const body = JSON.parse(
          vi.mocked(apiFetch).mock.calls[0][1]!.body as string,
        );
        expect(body.sharedWith).toBe(3);
      });
    });

    it('should send null sharedWith when unchecked in edit mode', async () => {
      const user = userEvent.setup();
      vi.mocked(apiFetch).mockReset();
      vi.mocked(apiFetch).mockResolvedValueOnce({});

      render(
        <SubscriptionForm
          subscription={{ ...existingSub, sharedWith: 3 }}
        />,
      );

      await user.click(screen.getByLabelText('Shared subscription'));
      await user.click(screen.getByRole('button', { name: 'Update' }));

      await waitFor(() => {
        expect(apiFetch).toHaveBeenCalled();
        const body = JSON.parse(
          vi.mocked(apiFetch).mock.calls[0][1]!.body as string,
        );
        expect(body.sharedWith).toBeNull();
      });
    });
  });

  describe('reminder days', () => {
    it('should mark the reminder field as required', () => {
      render(<SubscriptionForm />);
      expect(screen.getByLabelText(/Remind me before renewal/)).toBeRequired();
    });

    it('should block submission when the reminder field is cleared (no null sent)', async () => {
      const user = userEvent.setup();
      vi.mocked(apiFetch).mockClear();

      render(<SubscriptionForm subscription={existingSub} />);

      // Empty + required → the browser blocks submit, so parseInt('') → NaN → null
      // can never reach the API.
      await user.clear(screen.getByLabelText(/Remind me before renewal/));
      await user.click(screen.getByRole('button', { name: 'Update' }));

      expect(apiFetch).not.toHaveBeenCalled();
    });

    it('should send the entered reminder value as an integer', async () => {
      const user = userEvent.setup();
      vi.mocked(apiFetch).mockReset();
      vi.mocked(apiFetch).mockResolvedValueOnce({});

      render(<SubscriptionForm subscription={existingSub} />);

      const field = screen.getByLabelText(/Remind me before renewal/);
      await user.clear(field);
      await user.type(field, '7');
      await user.click(screen.getByRole('button', { name: 'Update' }));

      await waitFor(() => {
        expect(apiFetch).toHaveBeenCalled();
        const body = JSON.parse(
          vi.mocked(apiFetch).mock.calls[0][1]!.body as string,
        );
        expect(body.reminderDaysBefore).toBe(7);
      });
    });
  });

  describe('ledger account', () => {
    afterEach(() => {
      accountsState.accounts = ledgerAccounts;
      accountsState.loading = false;
      accountsState.error = null;
    });

    function lastBody() {
      const calls = vi.mocked(apiFetch).mock.calls;
      return JSON.parse(calls[calls.length - 1][1]!.body as string);
    }

    async function fillRequired(user: ReturnType<typeof userEvent.setup>) {
      await user.type(screen.getByLabelText('Name'), 'Spotify');
      await user.type(screen.getByLabelText('Cost ($)'), '9.99');
      await user.type(screen.getByLabelText('Next Billing Date'), '2025-07-01');
    }

    it('renders the Account select defaulting to not tracked, with each account as an option', () => {
      render(<SubscriptionForm />);

      const select = screen.getByLabelText('Account');
      expect(select).toHaveValue('');
      expect(
        screen.getByRole('option', { name: 'Not tracked in the ledger' }),
      ).toHaveProperty('selected', true);
      expect(screen.getByRole('option', { name: 'Checking' })).toBeInTheDocument();
      expect(screen.getByRole('option', { name: 'Visa' })).toBeInTheDocument();
    });

    it('sends the chosen accountId on create', async () => {
      const user = userEvent.setup();
      vi.mocked(apiFetch).mockReset();
      vi.mocked(apiFetch).mockResolvedValueOnce({});

      render(<SubscriptionForm />);
      await fillRequired(user);
      await user.selectOptions(screen.getByLabelText('Account'), 'acc-1');
      await user.click(screen.getByRole('button', { name: 'Create' }));

      await waitFor(() => expect(apiFetch).toHaveBeenCalled());
      expect(lastBody().accountId).toBe('acc-1');
    });

    it('omits accountId on create when no account is chosen', async () => {
      const user = userEvent.setup();
      vi.mocked(apiFetch).mockReset();
      vi.mocked(apiFetch).mockResolvedValueOnce({});

      render(<SubscriptionForm />);
      await fillRequired(user);
      await user.click(screen.getByRole('button', { name: 'Create' }));

      await waitFor(() => expect(apiFetch).toHaveBeenCalled());
      expect(lastBody()).not.toHaveProperty('accountId');
    });

    it('preselects the linked account and sends null when detached on edit', async () => {
      const user = userEvent.setup();
      vi.mocked(apiFetch).mockReset();
      vi.mocked(apiFetch).mockResolvedValueOnce({});

      render(<SubscriptionForm subscription={{ ...existingSub, accountId: 'acc-2' }} />);

      const select = screen.getByLabelText('Account');
      expect(select).toHaveValue('acc-2');

      await user.selectOptions(select, '');
      await user.click(screen.getByRole('button', { name: 'Update' }));

      await waitFor(() => expect(apiFetch).toHaveBeenCalled());
      expect(lastBody().accountId).toBeNull();
    });

    it('keeps an archived linked account selectable as a disabled placeholder', () => {
      render(<SubscriptionForm subscription={{ ...existingSub, accountId: 'acc-gone' }} />);

      const archived = screen.getByRole('option', {
        name: 'Current account (archived or unavailable)',
      });
      expect(archived).toBeDisabled();
      expect(screen.getByLabelText('Account')).toHaveValue('acc-gone');
    });

    it('disables the select with a loading placeholder while accounts load', () => {
      accountsState.accounts = [];
      accountsState.loading = true;

      render(<SubscriptionForm subscription={{ ...existingSub, accountId: 'acc-2' }} />);

      const select = screen.getByLabelText('Account');
      expect(select).toBeDisabled();
      expect(select).toHaveValue('acc-2');
      expect(screen.getByRole('option', { name: 'Loading accounts...' })).toBeInTheDocument();
      expect(screen.queryByRole('option', { name: /archived/ })).not.toBeInTheDocument();
    });

    it('selects a could-not-load placeholder for the linked account after a failed load', () => {
      accountsState.accounts = [];
      accountsState.error = 'Network down';

      render(<SubscriptionForm subscription={{ ...existingSub, accountId: 'acc-2' }} />);

      expect(screen.getByLabelText('Account')).toHaveValue('acc-2');
      const placeholder = screen.getByRole('option', {
        name: 'Current account (could not load accounts)',
      });
      expect(placeholder).toBeDisabled();
      expect(placeholder).toHaveProperty('selected', true);
      expect(screen.getByText(/Couldn.t load accounts: Network down/)).toBeInTheDocument();
    });

    it('keeps the linked account when an edit leaves the select untouched', async () => {
      const user = userEvent.setup();
      vi.mocked(apiFetch).mockReset();
      vi.mocked(apiFetch).mockResolvedValueOnce({});

      render(<SubscriptionForm subscription={{ ...existingSub, accountId: 'acc-2' }} />);
      await user.click(screen.getByRole('button', { name: 'Update' }));

      await waitFor(() => expect(apiFetch).toHaveBeenCalled());
      expect(lastBody().accountId).toBe('acc-2');
    });

    it('keeps an archived linked account when an edit leaves the select untouched', async () => {
      const user = userEvent.setup();
      vi.mocked(apiFetch).mockReset();
      vi.mocked(apiFetch).mockResolvedValueOnce({});

      render(<SubscriptionForm subscription={{ ...existingSub, accountId: 'acc-gone' }} />);
      await user.click(screen.getByRole('button', { name: 'Update' }));

      await waitFor(() => expect(apiFetch).toHaveBeenCalled());
      expect(lastBody().accountId).toBe('acc-gone');
    });

    it('shows the load error banner in create mode when accounts fail to load', () => {
      accountsState.accounts = [];
      accountsState.error = 'Network down';

      render(<SubscriptionForm />);

      expect(screen.getByText(/Couldn.t load accounts: Network down/)).toBeInTheDocument();
    });

    it('surfaces the server rejection for a free subscription', async () => {
      const message =
        'A free subscription cannot be tracked in an account. Set a cost above $0 or leave the account empty.';
      const user = userEvent.setup();
      vi.mocked(apiFetch).mockReset();
      vi.mocked(apiFetch).mockRejectedValueOnce(new Error(message));

      render(<SubscriptionForm />);
      await fillRequired(user);
      await user.selectOptions(screen.getByLabelText('Account'), 'acc-1');
      await user.click(screen.getByRole('button', { name: 'Create' }));

      await waitFor(() => {
        expect(screen.getByText(message)).toBeInTheDocument();
        expect(showErrorToast).toHaveBeenCalledWith(message);
      });
    });
  });

  describe('loading state', () => {
    it('should show Saving... and disable button during submission', async () => {
      const user = userEvent.setup();
      // Keep the promise pending
      let resolveApi!: () => void;
      vi.mocked(apiFetch).mockImplementation(
        () => new Promise((resolve) => { resolveApi = resolve as () => void; }),
      );

      render(<SubscriptionForm />);

      await user.type(screen.getByLabelText('Name'), 'Test');
      await user.type(screen.getByLabelText('Cost ($)'), '5');
      await user.type(screen.getByLabelText('Next Billing Date'), '2025-07-01');

      await user.click(screen.getByRole('button', { name: 'Create' }));

      expect(screen.getByRole('button', { name: 'Saving...' })).toBeDisabled();

      // Resolve to clean up
      resolveApi();
    });
  });
});
