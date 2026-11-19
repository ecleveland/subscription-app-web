import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

let authState: { isAuthenticated: boolean };
vi.mock('../auth-context', () => ({ useAuth: () => authState }));
vi.mock('../labels', () => ({ listLabels: vi.fn() }));
let pathname = '/';
vi.mock('next/navigation', () => ({ usePathname: () => pathname }));

import { listLabels } from '../labels';
import { LabelsProvider, useLabels } from '../labels-context';
import type { Label } from '../types';

const label: Label = {
  _id: 'l1',
  householdId: 'h1',
  name: 'Etsy shop',
  color: '#2f8a93',
  isArchived: false,
  createdAt: '',
  updatedAt: '',
};

function Consumer() {
  const { labels, loading, error, refresh } = useLabels();
  return (
    <div>
      <span>loading:{String(loading)}</span>
      <span>count:{labels.length}</span>
      <span>error:{error ?? 'none'}</span>
      <button onClick={() => refresh()}>refresh</button>
    </div>
  );
}

function renderProvider() {
  return render(
    <LabelsProvider>
      <Consumer />
    </LabelsProvider>,
  );
}

describe('LabelsContext', () => {
  beforeEach(() => {
    pathname = '/';
  });
  afterEach(() => vi.clearAllMocks());

  it('loads labels with archived ones when authenticated', async () => {
    authState = { isAuthenticated: true };
    vi.mocked(listLabels).mockResolvedValue([label]);

    renderProvider();

    await waitFor(() => expect(screen.getByText('count:1')).toBeInTheDocument());
    expect(screen.getByText('loading:false')).toBeInTheDocument();
    expect(listLabels).toHaveBeenCalledWith(true);
  });

  it('stays empty and does not fetch when unauthenticated', async () => {
    authState = { isAuthenticated: false };

    renderProvider();

    await waitFor(() => expect(screen.getByText('loading:false')).toBeInTheDocument());
    expect(screen.getByText('count:0')).toBeInTheDocument();
    expect(listLabels).not.toHaveBeenCalled();
  });

  it('refresh re-fetches', async () => {
    authState = { isAuthenticated: true };
    vi.mocked(listLabels).mockResolvedValue([label]);

    renderProvider();
    await waitFor(() => expect(screen.getByText('count:1')).toBeInTheDocument());

    await userEvent.click(screen.getByText('refresh'));
    await waitFor(() => expect(listLabels).toHaveBeenCalledTimes(2));
  });

  it('refetches when the route changes so a new label shows up', async () => {
    authState = { isAuthenticated: true };
    vi.mocked(listLabels).mockResolvedValueOnce([]);

    const { rerender } = renderProvider();
    await waitFor(() => expect(screen.getByText('loading:false')).toBeInTheDocument());
    expect(screen.getByText('count:0')).toBeInTheDocument();

    vi.mocked(listLabels).mockResolvedValueOnce([label]);
    pathname = '/transactions';
    rerender(
      <LabelsProvider>
        <Consumer />
      </LabelsProvider>,
    );

    await waitFor(() => expect(screen.getByText('count:1')).toBeInTheDocument());
    expect(listLabels).toHaveBeenCalledTimes(2);
  });

  it('keeps last-known labels and records the error on a failed refresh', async () => {
    authState = { isAuthenticated: true };
    vi.mocked(listLabels).mockResolvedValueOnce([label]);

    renderProvider();
    await waitFor(() => expect(screen.getByText('count:1')).toBeInTheDocument());

    vi.mocked(listLabels).mockRejectedValueOnce(new Error('network down'));
    await userEvent.click(screen.getByText('refresh'));

    await waitFor(() =>
      expect(screen.getByText('error:network down')).toBeInTheDocument(),
    );
    expect(screen.getByText('count:1')).toBeInTheDocument();
  });

  it('throws when used outside the provider', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<Consumer />)).toThrow(
      'useLabels must be used within a LabelsProvider',
    );
    spy.mockRestore();
  });
});
