import { render, screen } from '@testing-library/react';
import CategoryBreakdownChart from '../CategoryBreakdownChart';
import type { Subscription } from '@/lib/types';

// Recharts uses ResizeObserver internally
global.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

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

describe('CategoryBreakdownChart', () => {
  it('should render without crashing with valid subscription data', () => {
    const subs = [
      makeSub({ _id: '1', name: 'Netflix', cost: 15, category: 'Streaming' }),
      makeSub({ _id: '2', name: 'Spotify', cost: 10, category: 'Streaming' }),
      makeSub({ _id: '3', name: 'GitHub', cost: 4, category: 'Software' }),
    ];

    const { container } = render(<CategoryBreakdownChart subscriptions={subs} />);
    expect(container.firstChild).toBeTruthy();
  });

  it('should handle empty subscriptions array', () => {
    render(<CategoryBreakdownChart subscriptions={[]} />);

    expect(screen.getByText('No active subscriptions to display.')).toBeInTheDocument();
  });

  it('should show empty state when all subscriptions are inactive', () => {
    const subs = [
      makeSub({ _id: '1', isActive: false }),
    ];

    render(<CategoryBreakdownChart subscriptions={subs} />);

    expect(screen.getByText('No active subscriptions to display.')).toBeInTheDocument();
  });
});
