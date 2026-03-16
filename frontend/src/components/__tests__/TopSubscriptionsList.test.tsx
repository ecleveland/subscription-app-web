import { render, screen } from '@testing-library/react';
import TopSubscriptionsList from '../TopSubscriptionsList';
import type { Subscription } from '@/lib/types';

function makeSub(overrides: Partial<Subscription> = {}): Subscription {
  return {
    _id: '1',
    userId: 'u1',
    name: 'Test',
    cost: 10,
    billingCycle: 'monthly',
    nextBillingDate: '2025-06-01',
    category: 'Streaming',
    isActive: true,
    createdAt: '2025-01-01',
    updatedAt: '2025-01-01',
    ...overrides,
  };
}

describe('TopSubscriptionsList', () => {
  it('should render top 5 subscriptions ranked by monthly cost', () => {
    const subs = [
      makeSub({ _id: '1', name: 'Cheap', cost: 5, billingCycle: 'monthly' }),
      makeSub({ _id: '2', name: 'Expensive', cost: 50, billingCycle: 'monthly' }),
      makeSub({ _id: '3', name: 'Medium', cost: 20, billingCycle: 'monthly' }),
      makeSub({ _id: '4', name: 'Yearly Big', cost: 360, billingCycle: 'yearly', category: 'Software' }),
      makeSub({ _id: '5', name: 'Weekly', cost: 10, billingCycle: 'weekly', category: 'Gaming' }),
      makeSub({ _id: '6', name: 'Sixth', cost: 2, billingCycle: 'monthly', category: 'Other' }),
    ];

    render(<TopSubscriptionsList subscriptions={subs} />);

    // Top 5 should be shown, not the 6th
    expect(screen.getByText('Expensive')).toBeInTheDocument();
    expect(screen.getByText('Weekly')).toBeInTheDocument();
    expect(screen.getByText('Yearly Big')).toBeInTheDocument();
    expect(screen.getByText('Medium')).toBeInTheDocument();
    expect(screen.getByText('Cheap')).toBeInTheDocument();
    expect(screen.queryByText('Sixth')).not.toBeInTheDocument();

    // Check rank numbers
    const ranks = screen.getAllByText(/^[1-5]$/);
    expect(ranks).toHaveLength(5);
  });

  it('should show formatted costs', () => {
    const subs = [
      makeSub({ _id: '1', name: 'Netflix', cost: 15.99, billingCycle: 'monthly' }),
    ];

    render(<TopSubscriptionsList subscriptions={subs} />);

    expect(screen.getByText('$15.99/mo')).toBeInTheDocument();
  });

  it('should handle empty subscriptions array', () => {
    render(<TopSubscriptionsList subscriptions={[]} />);

    expect(screen.getByText('No active subscriptions to display.')).toBeInTheDocument();
  });

  it('should exclude inactive subscriptions', () => {
    const subs = [
      makeSub({ _id: '1', name: 'Active', cost: 10, isActive: true }),
      makeSub({ _id: '2', name: 'Inactive', cost: 100, isActive: false }),
    ];

    render(<TopSubscriptionsList subscriptions={subs} />);

    expect(screen.getByText('Active')).toBeInTheDocument();
    expect(screen.queryByText('Inactive')).not.toBeInTheDocument();
  });
});
