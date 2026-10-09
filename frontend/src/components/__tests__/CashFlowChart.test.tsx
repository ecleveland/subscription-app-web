import { render, screen, within } from '@testing-library/react';
import CashFlowChart from '../CashFlowChart';

// Recharts uses ResizeObserver internally
global.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

const months = [
  { month: '2026-09', incomeCents: 500000, expenseCents: 320000, netCents: 180000 },
  { month: '2026-10', incomeCents: 0, expenseCents: 12345, netCents: -12345 },
];

describe('CashFlowChart', () => {
  it('renders without crashing', () => {
    const { container } = render(<CashFlowChart months={months} />);
    expect(container.firstChild).toBeTruthy();
  });

  it('lists each month with formatted income, expenses and net', () => {
    render(<CashFlowChart months={months} />);
    const table = screen.getByRole('table', { name: 'Cash flow by month' });
    const rows = within(table).getAllByRole('row');
    // Header plus one row per month.
    expect(rows).toHaveLength(3);
    expect(within(rows[1]).getByText('Sep 2026')).toBeInTheDocument();
    expect(within(rows[1]).getByText('$5,000.00')).toBeInTheDocument();
    expect(within(rows[1]).getByText('$3,200.00')).toBeInTheDocument();
    expect(within(rows[1]).getByText('$1,800.00')).toBeInTheDocument();
    expect(within(rows[2]).getByText('-$123.45')).toBeInTheDocument();
  });
});
