import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SubscriptionCard from '../SubscriptionCard';
import type { Subscription } from '@/lib/types';

vi.mock('@/lib/api', () => ({
  apiFetch: vi.fn(),
}));

import { apiFetch } from '@/lib/api';

function makeSub(overrides: Partial<Subscription> = {}): Subscription {
  return {
    _id: 'sub-1',
    userId: 'u1',
    name: 'Netflix',
    cost: 15.99,
    billingCycle: 'monthly',
    nextBillingDate: '2025-07-01T00:00:00',
    category: 'Streaming',
    isActive: true,
    createdAt: '2025-01-01',
    updatedAt: '2025-01-01',
    ...overrides,
  };
}

describe('SubscriptionCard', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-06-15T12:00:00'));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('should render subscription name and formatted cost', () => {
    render(<SubscriptionCard subscription={makeSub()} />);

    expect(screen.getByText('Netflix')).toBeInTheDocument();
    expect(screen.getByText('$15.99')).toBeInTheDocument();
  });

  it('should show billing cycle abbreviation', () => {
    render(<SubscriptionCard subscription={makeSub({ billingCycle: 'monthly' })} />);
    expect(screen.getByText('/mo')).toBeInTheDocument();
  });

  it('should show yearly abbreviation for yearly subscriptions', () => {
    render(<SubscriptionCard subscription={makeSub({ billingCycle: 'yearly', cost: 120 })} />);
    expect(screen.getByText('/yr')).toBeInTheDocument();
  });

  it('should show weekly abbreviation for weekly subscriptions', () => {
    render(<SubscriptionCard subscription={makeSub({ billingCycle: 'weekly', cost: 25 })} />);
    expect(screen.getByText('/wk')).toBeInTheDocument();
  });

  it('should show monthly equivalent for weekly subscriptions', () => {
    render(<SubscriptionCard subscription={makeSub({ billingCycle: 'weekly', cost: 10 })} />);
    // $10/wk * 4.33 = $43.30/mo
    expect(screen.getByText('($43.30/mo)')).toBeInTheDocument();
  });

  it('should show monthly equivalent for yearly subscriptions', () => {
    render(<SubscriptionCard subscription={makeSub({ billingCycle: 'yearly', cost: 120 })} />);
    // $120/yr = $10/mo
    expect(screen.getByText('($10.00/mo)')).toBeInTheDocument();
  });

  it('should show Inactive badge when subscription is inactive', () => {
    render(<SubscriptionCard subscription={makeSub({ isActive: false })} />);
    expect(screen.getByText('Inactive')).toBeInTheDocument();
  });

  it('should not show Inactive badge when subscription is active', () => {
    render(<SubscriptionCard subscription={makeSub({ isActive: true })} />);
    expect(screen.queryByText('Inactive')).not.toBeInTheDocument();
  });

  it('should show days until next billing', () => {
    // June 15 → July 1 = 16 days
    render(<SubscriptionCard subscription={makeSub()} />);
    expect(screen.getByText(/in 16 days/)).toBeInTheDocument();
  });

  it('should show "today" when billing is today', () => {
    render(
      <SubscriptionCard
        subscription={makeSub({ nextBillingDate: '2025-06-15T12:00:00' })}
      />,
    );
    expect(screen.getByText(/today/)).toBeInTheDocument();
  });

  it('should not show countdown for inactive subscriptions', () => {
    render(
      <SubscriptionCard
        subscription={makeSub({ nextBillingDate: '2025-06-10T12:00:00', isActive: false })}
      />,
    );
    expect(screen.getByText(/Jun 10, 2025/)).toBeInTheDocument();
    expect(screen.queryByText(/overdue/)).not.toBeInTheDocument();
    expect(screen.queryByText(/in \d+ day/)).not.toBeInTheDocument();
    expect(screen.queryByText(/today/)).not.toBeInTheDocument();
  });

  it('should call PATCH on toggle and invoke onToggleActive callback', async () => {
    vi.useRealTimers(); // userEvent.click needs real timers
    vi.mocked(apiFetch).mockResolvedValueOnce(undefined);
    const onToggle = vi.fn();

    render(
      <SubscriptionCard subscription={makeSub()} onToggleActive={onToggle} />,
    );

    const toggleButton = screen.getByRole('button', { name: /deactivate/i });
    await userEvent.click(toggleButton);

    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledWith('/subscriptions/sub-1', {
        method: 'PATCH',
        body: JSON.stringify({ isActive: false }),
      });
    });

    await waitFor(() => {
      expect(onToggle).toHaveBeenCalledWith('sub-1', false);
    });
  });

  it('should revert toggle on API failure', async () => {
    vi.useRealTimers(); // userEvent.click needs real timers
    vi.mocked(apiFetch).mockRejectedValueOnce(new Error('Network error'));

    render(<SubscriptionCard subscription={makeSub({ isActive: true })} />);

    const toggleButton = screen.getByRole('button', { name: /deactivate/i });
    await userEvent.click(toggleButton);

    // After failure, the Inactive badge should NOT appear (reverted)
    await waitFor(() => {
      expect(screen.queryByText('Inactive')).not.toBeInTheDocument();
    });
  });
});
