import { render, screen } from '@testing-library/react';
import DashboardSummary from '../DashboardSummary';
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

describe('DashboardSummary', () => {
  it('should show $0.00 for all cost tiles and 0 active when no subscriptions', () => {
    render(<DashboardSummary subscriptions={[]} />);

    const zeroPrices = screen.getAllByText('$0.00');
    expect(zeroPrices).toHaveLength(4); // daily, weekly, monthly, yearly
    expect(screen.getByText('0')).toBeInTheDocument(); // active count
    expect(screen.getByText('0 inactive')).toBeInTheDocument();
  });

  it('should sum monthly costs correctly', () => {
    const subs = [
      makeSub({ _id: '1', cost: 10, billingCycle: 'monthly' }),
      makeSub({ _id: '2', cost: 120, billingCycle: 'yearly' }), // $10/mo
    ];

    render(<DashboardSummary subscriptions={subs} />);

    // Monthly total: $10 + $10 = $20.00
    expect(screen.getByText('$20.00')).toBeInTheDocument();
  });

  it('should sum yearly costs correctly', () => {
    const subs = [
      makeSub({ _id: '1', cost: 10, billingCycle: 'monthly' }), // $120/yr
      makeSub({ _id: '2', cost: 120, billingCycle: 'yearly' }),
    ];

    render(<DashboardSummary subscriptions={subs} />);

    // Yearly total: $120 + $120 = $240.00
    expect(screen.getByText('$240.00')).toBeInTheDocument();
  });

  it('should display daily cost', () => {
    // $365/year = $1/day
    const subs = [makeSub({ _id: '1', cost: 365, billingCycle: 'yearly' })];

    render(<DashboardSummary subscriptions={subs} />);

    expect(screen.getByText('$1.00')).toBeInTheDocument();
  });

  it('should display weekly cost', () => {
    // $365/year = $7/week
    const subs = [makeSub({ _id: '1', cost: 365, billingCycle: 'yearly' })];

    render(<DashboardSummary subscriptions={subs} />);

    expect(screen.getByText('$7.00')).toBeInTheDocument();
  });

  it('should show active and inactive counts in combined tile', () => {
    const subs = [
      makeSub({ _id: '1', isActive: true }),
      makeSub({ _id: '2', isActive: true }),
      makeSub({ _id: '3', isActive: false }),
    ];

    render(<DashboardSummary subscriptions={subs} />);

    expect(screen.getByText('2')).toBeInTheDocument(); // active
    expect(screen.getByText('1 inactive')).toBeInTheDocument();
  });

  it('should exclude inactive subscriptions from cost totals', () => {
    const subs = [
      makeSub({ _id: '1', cost: 10, billingCycle: 'monthly', isActive: true }),
      makeSub({ _id: '2', cost: 20, billingCycle: 'monthly', isActive: false }),
    ];

    render(<DashboardSummary subscriptions={subs} />);

    // Monthly should be $10.00, not $30.00
    expect(screen.getByText('$10.00')).toBeInTheDocument();
  });
});
