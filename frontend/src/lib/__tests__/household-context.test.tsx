import { renderHook, waitFor, act } from '@testing-library/react';
import { HouseholdProvider, useHousehold } from '../household-context';

vi.mock('@/lib/households', () => ({
  getMyHousehold: vi.fn(),
}));

let authValue: Record<string, unknown>;
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => authValue,
}));

import { getMyHousehold } from '@/lib/households';

const household = {
  _id: 'h1',
  name: 'HH',
  currency: 'USD',
  ownerId: 'u1',
};
const members = [
  { _id: 'm1', role: 'owner', userId: { _id: 'u1', username: 'owner' } },
  { _id: 'm2', role: 'adult', userId: { _id: 'u2', username: 'adult' } },
];

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <HouseholdProvider>{children}</HouseholdProvider>
);

describe('HouseholdProvider / useHousehold', () => {
  afterEach(() => vi.clearAllMocks());

  it('loads the household and derives currentMember/isOwner for the owner', async () => {
    authValue = { isAuthenticated: true, user: { userId: 'u1' } };
    vi.mocked(getMyHousehold).mockResolvedValueOnce({
      household,
      members,
    } as never);

    const { result } = renderHook(() => useHousehold(), { wrapper });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.household).toEqual(household);
    expect(result.current.members).toHaveLength(2);
    expect(result.current.currentMember?._id).toBe('m1');
    expect(result.current.isOwner).toBe(true);
  });

  it('derives a non-owner correctly', async () => {
    authValue = { isAuthenticated: true, user: { userId: 'u2' } };
    vi.mocked(getMyHousehold).mockResolvedValueOnce({
      household,
      members,
    } as never);

    const { result } = renderHook(() => useHousehold(), { wrapper });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.currentMember?._id).toBe('m2');
    expect(result.current.isOwner).toBe(false);
  });

  it('does not fetch when unauthenticated', async () => {
    authValue = { isAuthenticated: false, user: null };

    const { result } = renderHook(() => useHousehold(), { wrapper });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(getMyHousehold).not.toHaveBeenCalled();
    expect(result.current.household).toBeNull();
  });

  it('keeps the last-known household when a refresh fails', async () => {
    authValue = { isAuthenticated: true, user: { userId: 'u1' } };
    vi.mocked(getMyHousehold)
      .mockResolvedValueOnce({ household, members } as never)
      .mockRejectedValueOnce(new Error('boom'));

    const { result } = renderHook(() => useHousehold(), { wrapper });
    await waitFor(() => expect(result.current.household).toEqual(household));

    await act(async () => {
      await result.current.refresh();
    });

    expect(result.current.error).toBe('boom');
    // The previously loaded household is retained, not blanked.
    expect(result.current.household).toEqual(household);
    expect(result.current.members).toHaveLength(2);
  });
});
