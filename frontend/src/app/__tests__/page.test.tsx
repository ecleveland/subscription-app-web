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

describe('DashboardPage search (server-driven)', () => {
  const subs = [
    makeSub({ _id: '1', name: 'Netflix', notes: 'Family plan', cost: 15 }),
    makeSub({ _id: '2', name: 'Spotify', notes: 'Music streaming', cost: 10 }),
    makeSub({ _id: '3', name: 'GitHub', cost: 4 }),
  ];

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.mocked(apiFetch).mockResolvedValue(makeEnvelope(subs));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('should render the search input', async () => {
    render(<DashboardPage />);
    expect(await screen.findByLabelText('Search subscriptions')).toBeInTheDocument();
  });

  it('should send the (debounced) search term to the server on page 1', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<DashboardPage />);

    await screen.findByText('Netflix');
    await user.type(screen.getByLabelText('Search subscriptions'), 'net');

    await waitFor(() => {
      const calls = vi.mocked(apiFetch).mock.calls.map((c) => c[0] as string);
      expect(
        calls.some((url) => url.includes('search=net') && url.includes('page=1')),
      ).toBe(true);
    });
  });

  it('should show the no-results message when the server returns no matches', async () => {
    // mount: [0] list, [1] summary (limit=0); then the search refetch is empty
    vi.mocked(apiFetch)
      .mockResolvedValueOnce(makeEnvelope(subs))
      .mockResolvedValueOnce(makeEnvelope(subs))
      .mockResolvedValue(makeEnvelope([], { total: 0 }));

    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<DashboardPage />);

    await screen.findByText('Netflix');
    await user.type(screen.getByLabelText('Search subscriptions'), 'zzzzz');

    await waitFor(() => {
      expect(screen.getByText(/No subscriptions match/)).toBeInTheDocument();
    });
  });

  it('should drop the search param when the field is cleared', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<DashboardPage />);

    await screen.findByText('Netflix');
    await user.type(screen.getByLabelText('Search subscriptions'), 'net');

    await waitFor(() => {
      const calls = vi.mocked(apiFetch).mock.calls.map((c) => c[0] as string);
      expect(calls.some((url) => url.includes('search=net'))).toBe(true);
    });

    await user.click(screen.getByLabelText('Clear search'));

    await waitFor(() => {
      const lastListCall = vi
        .mocked(apiFetch)
        .mock.calls.map((c) => c[0] as string)
        .filter((url) => url.includes('sortBy='))
        .at(-1)!;
      expect(lastListCall).not.toContain('search=');
    });
  });
});

describe('DashboardPage filters (server-driven)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should send the shared filter to the server', async () => {
    vi.mocked(apiFetch).mockResolvedValue(makeEnvelope([makeSub()]));
    const user = userEvent.setup();
    render(<DashboardPage />);

    await user.click(await screen.findByRole('button', { name: 'Shared' }));

    await waitFor(() => {
      const calls = vi.mocked(apiFetch).mock.calls.map((c) => c[0] as string);
      expect(calls.some((url) => url.includes('shared=shared'))).toBe(true);
    });
  });

  it('should send selected tags to the server', async () => {
    vi.mocked(apiFetch).mockResolvedValue(
      makeEnvelope([makeSub({ tags: ['essential'] })]),
    );
    const user = userEvent.setup();
    render(<DashboardPage />);

    await user.click(await screen.findByRole('button', { name: 'essential' }));

    await waitFor(() => {
      const calls = vi.mocked(apiFetch).mock.calls.map((c) => c[0] as string);
      expect(calls.some((url) => url.includes('tags=essential'))).toBe(true);
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

describe('DashboardPage bulk edit', () => {
  beforeEach(() => {
    vi.mocked(apiFetch).mockResolvedValue(makeEnvelope());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should render the Edit Multiple button', async () => {
    render(<DashboardPage />);
    expect(await screen.findByText('Edit Multiple')).toBeInTheDocument();
  });

  it('should enter selection mode when Edit Multiple is clicked', async () => {
    const user = userEvent.setup();
    render(<DashboardPage />);

    await user.click(await screen.findByText('Edit Multiple'));

    expect(screen.getByText('Select cards to edit them in bulk')).toBeInTheDocument();
    expect(screen.queryByText('Edit Multiple')).not.toBeInTheDocument();
  });

  it('should exit selection mode when Cancel is clicked', async () => {
    const user = userEvent.setup();
    render(<DashboardPage />);

    await user.click(await screen.findByText('Edit Multiple'));
    expect(screen.getByText('Select cards to edit them in bulk')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.getByText('Edit Multiple')).toBeInTheDocument();
    expect(screen.queryByText('Select cards to edit them in bulk')).not.toBeInTheDocument();
  });
});
