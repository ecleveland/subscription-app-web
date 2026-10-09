import { render, screen, within } from '@testing-library/react';
import SpendingReportChart from '../SpendingReportChart';
import type { SpendingReport } from '@/lib/reports';

// Recharts uses ResizeObserver internally
global.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

function report(overrides: Partial<SpendingReport> = {}): SpendingReport {
  return {
    month: '2026-10',
    categories: [
      {
        categoryId: 'c1',
        categoryName: 'Groceries',
        groupId: 'g1',
        groupName: 'Food',
        actualCents: 45000,
        plannedCents: 50000,
      },
      {
        categoryId: 'c2',
        categoryName: 'Gas',
        groupId: 'g2',
        groupName: null,
        actualCents: 8000,
        plannedCents: null,
      },
    ],
    uncategorizedCents: 2000,
    totalCents: 55000,
    ...overrides,
  };
}

describe('SpendingReportChart', () => {
  it('renders without crashing', () => {
    const { container } = render(<SpendingReportChart report={report()} />);
    expect(container.firstChild).toBeTruthy();
  });

  it('keeps the backend order and appends Uncategorized when it has spend', () => {
    render(<SpendingReportChart report={report()} />);
    const table = screen.getByRole('table', { name: 'Spending by category' });
    const rows = within(table).getAllByRole('row');
    expect(rows).toHaveLength(4);
    expect(within(rows[1]).getByText('Groceries')).toBeInTheDocument();
    expect(within(rows[1]).getByText('$450.00')).toBeInTheDocument();
    expect(within(rows[1]).getByText('$500.00')).toBeInTheDocument();
    expect(within(rows[2]).getByText('Gas')).toBeInTheDocument();
    expect(within(rows[3]).getByText('Uncategorized')).toBeInTheDocument();
    expect(within(rows[3]).getByText('$20.00')).toBeInTheDocument();
  });

  it('shows no planned amount for a category without a budget row', () => {
    render(<SpendingReportChart report={report()} />);
    const gasRow = screen.getByText('Gas').closest('tr')!;
    expect(within(gasRow).getByText('No budget')).toBeInTheDocument();
  });

  it('omits Uncategorized when there is no uncategorized spend', () => {
    render(
      <SpendingReportChart
        report={report({ uncategorizedCents: 0, totalCents: 53000 })}
      />,
    );
    expect(screen.queryByText('Uncategorized')).not.toBeInTheDocument();
  });

  it('shows the total under the chart', () => {
    render(<SpendingReportChart report={report()} />);
    expect(screen.getByText('Total spent: $550.00')).toBeInTheDocument();
  });
});
