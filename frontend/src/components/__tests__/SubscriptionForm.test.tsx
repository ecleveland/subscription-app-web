import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SubscriptionForm from '../SubscriptionForm';
import type { Subscription } from '@/lib/types';

vi.mock('@/lib/api', () => ({
  apiFetch: vi.fn(),
}));

vi.mock('@/lib/toast', () => ({
  showErrorToast: vi.fn(),
  showSuccessToast: vi.fn(),
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
