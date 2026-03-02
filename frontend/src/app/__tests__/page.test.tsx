import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Subscription, PaginatedResponse } from '@/lib/types';

vi.mock('@/lib/api', () => ({
  apiFetch: vi.fn(),
}));

vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ isAuthenticated: true }),
}));

import { apiFetch } from '@/lib/api';
import DashboardPage from '../page';

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

function makeEnvelope(
  subs: Subscription[] = [makeSub()],
  meta: Partial<PaginatedResponse<Subscription>['meta']> = {},
): PaginatedResponse<Subscription> {
  return {
    data: subs,
    meta: {
      total: subs.length,
      page: 1,
      limit: 20,
      totalPages: 1,
      hasNextPage: false,
      ...meta,
    },
  };
}

describe('DashboardPage sorting', () => {
  beforeEach(() => {
    vi.mocked(apiFetch).mockResolvedValue(makeEnvelope());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should fetch with nextBillingDate asc by default', async () => {
    render(<DashboardPage />);

    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledWith(
        '/subscriptions?sortBy=nextBillingDate&sortOrder=asc&page=1&limit=20',
      );
    });
  });

  it('should fetch all subscriptions for summary', async () => {
    render(<DashboardPage />);

    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledWith('/subscriptions?limit=0');
    });
  });

  it('should render the sort dropdown with all options', async () => {
    render(<DashboardPage />);

    const select = await screen.findByLabelText('Sort by');
    const options = select.querySelectorAll('option');
    expect(options).toHaveLength(5);
    expect(options[0]).toHaveTextContent('Next billing date');
    expect(options[1]).toHaveTextContent('Name (A–Z)');
    expect(options[2]).toHaveTextContent('Monthly cost (low to high)');
    expect(options[3]).toHaveTextContent('Monthly cost (high to low)');
    expect(options[4]).toHaveTextContent('Date added (newest)');
  });

  it('should re-fetch with updated sort params when selection changes', async () => {
    const user = userEvent.setup();
    render(<DashboardPage />);

    const select = await screen.findByLabelText('Sort by');
    await user.selectOptions(select, 'cost-desc');

    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledWith(
        '/subscriptions?sortBy=cost&sortOrder=desc&page=1&limit=20',
      );
    });
  });
});

describe('DashboardPage pagination', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should show pagination controls when totalPages > 1', async () => {
    vi.mocked(apiFetch).mockResolvedValue(
      makeEnvelope([makeSub()], { totalPages: 3, hasNextPage: true }),
    );

    render(<DashboardPage />);

    await waitFor(() => {
      expect(screen.getByText('Page 1 of 3')).toBeInTheDocument();
    });
    expect(screen.getByLabelText('Next page')).toBeInTheDocument();
  });

  it('should hide pagination controls when totalPages is 1', async () => {
    vi.mocked(apiFetch).mockResolvedValue(
      makeEnvelope([makeSub()], { totalPages: 1 }),
    );

    render(<DashboardPage />);

    await waitFor(() => {
      expect(screen.getByText('Test')).toBeInTheDocument();
    });
    expect(screen.queryByLabelText('Next page')).not.toBeInTheDocument();
  });

  it('should fetch next page when Next is clicked', async () => {
    vi.mocked(apiFetch).mockResolvedValue(
      makeEnvelope([makeSub()], { totalPages: 3, hasNextPage: true }),
    );

    const user = userEvent.setup();
    render(<DashboardPage />);

    await waitFor(() => {
      expect(screen.getByText('Page 1 of 3')).toBeInTheDocument();
    });

    await user.click(screen.getByLabelText('Next page'));

    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledWith(
        '/subscriptions?sortBy=nextBillingDate&sortOrder=asc&page=2&limit=20',
      );
    });
  });
});
