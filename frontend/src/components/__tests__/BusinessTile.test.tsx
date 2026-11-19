import { render, screen } from '@testing-library/react';

vi.mock('@/lib/reports', async (importActual) => ({
  ...(await importActual<typeof import('@/lib/reports')>()),
  getBusinessReport: vi.fn(),
}));
vi.mock('@/lib/toast', () => ({
  showErrorToast: vi.fn(),
  showSuccessToast: vi.fn(),
}));

import { getBusinessReport, type BusinessReport } from '@/lib/reports';
import { showErrorToast } from '@/lib/toast';
import BusinessTile from '../BusinessTile';

const currentMonth = new Date().toISOString().slice(0, 7);

function report(overrides: Partial<BusinessReport> = {}): BusinessReport {
  return {
    from: currentMonth,
    to: currentMonth,
    labelId: null,
    months: [
      { month: currentMonth, expenseCents: 12345, incomeCents: 50000, reimbursedCents: 0 },
    ],
    categories: [],
    uncategorizedCents: 0,
    totalCents: 12345,
    reimbursements: {
      owedCents: 5500,
      owedCount: 2,
      reimbursedCents: 0,
      owed: [],
      reimbursed: [],
    },
    ...overrides,
  };
}

describe('BusinessTile', () => {
  afterEach(() => vi.clearAllMocks());

  it('asks for the current month across every label', async () => {
    vi.mocked(getBusinessReport).mockResolvedValue(report());
    render(<BusinessTile />);

    await screen.findByText('$123.45');
    expect(getBusinessReport).toHaveBeenCalledWith(currentMonth, currentMonth);
  });

  it('shows this month spend, outstanding reimbursements and a link to the page', async () => {
    vi.mocked(getBusinessReport).mockResolvedValue(report());
    render(<BusinessTile />);

    expect(screen.getByText('Business this month')).toBeInTheDocument();
    expect(await screen.findByText('$123.45')).toBeInTheDocument();
    expect(screen.getByText('$55.00')).toBeInTheDocument();
    expect(screen.getByText('2 expenses')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open Business' })).toHaveAttribute(
      'href',
      '/business',
    );
  });

  it('says loading until the report arrives', () => {
    vi.mocked(getBusinessReport).mockReturnValue(new Promise(() => {}));
    render(<BusinessTile />);
    expect(screen.getByText('Loading…')).toBeInTheDocument();
  });

  it('shows the error inline without a toast', async () => {
    vi.mocked(getBusinessReport).mockRejectedValue(new Error('Report down'));
    render(<BusinessTile />);

    expect(await screen.findByText('Report down')).toBeInTheDocument();
    expect(showErrorToast).not.toHaveBeenCalled();
    expect(screen.getByRole('link', { name: 'Open Business' })).toBeInTheDocument();
  });

  it('shows zero spend when the month has no entry', async () => {
    vi.mocked(getBusinessReport).mockResolvedValue(
      report({
        months: [],
        reimbursements: {
          owedCents: 0,
          owedCount: 0,
          reimbursedCents: 0,
          owed: [],
          reimbursed: [],
        },
      }),
    );
    render(<BusinessTile />);

    expect(await screen.findAllByText('$0.00')).toHaveLength(2);
    expect(screen.getByText('0 expenses')).toBeInTheDocument();
  });
});
