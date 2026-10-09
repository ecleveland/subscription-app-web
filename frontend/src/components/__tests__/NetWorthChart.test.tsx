import { render, screen, within } from '@testing-library/react';
import NetWorthChart from '../NetWorthChart';
import type { NetWorthMonth } from '@/lib/reports';

// Recharts uses ResizeObserver internally
global.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

const months: NetWorthMonth[] = [
  {
    month: '2026-09',
    assetsCents: 1000000,
    liabilitiesCents: -250000,
    netWorthCents: 750000,
    accounts: [],
  },
  {
    month: '2026-10',
    assetsCents: 1200000,
    liabilitiesCents: -200000,
    netWorthCents: 1000000,
    accounts: [
      { accountId: 'a1', name: 'Checking', type: 'checking', balanceCents: 1200000 },
      { accountId: 'a2', name: 'Visa', type: 'credit', balanceCents: -200000 },
    ],
  },
];

describe('NetWorthChart', () => {
  it('renders without crashing', () => {
    const { container } = render(<NetWorthChart months={months} />);
    expect(container.firstChild).toBeTruthy();
  });

  it('headlines the last month net worth', () => {
    render(<NetWorthChart months={months} />);
    expect(screen.getByTestId('net-worth-headline')).toHaveTextContent(
      '$10,000.00',
    );
  });

  it('headlines a negative net worth with its sign', () => {
    render(
      <NetWorthChart
        months={[{ ...months[0], netWorthCents: -5000 }]}
      />,
    );
    expect(screen.getByTestId('net-worth-headline')).toHaveTextContent(
      '-$50.00',
    );
  });

  it('lists assets, liabilities and net worth per month', () => {
    render(<NetWorthChart months={months} />);
    const table = screen.getByRole('table', { name: 'Net worth by month' });
    const rows = within(table).getAllByRole('row');
    expect(rows).toHaveLength(3);
    expect(within(rows[1]).getByText('Sep 2026')).toBeInTheDocument();
    expect(within(rows[1]).getByText('-$2,500.00')).toBeInTheDocument();
    expect(within(rows[2]).getByText('$12,000.00')).toBeInTheDocument();
  });
});
