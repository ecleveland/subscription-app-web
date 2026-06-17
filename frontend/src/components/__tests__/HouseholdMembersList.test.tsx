import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import HouseholdMembersList from '../HouseholdMembersList';

vi.mock('@/lib/households', () => ({
  removeMember: vi.fn(),
}));

vi.mock('@/lib/toast', () => ({
  showErrorToast: vi.fn(),
  showSuccessToast: vi.fn(),
}));

let householdCtx: Record<string, unknown>;
vi.mock('@/lib/household-context', () => ({
  useHousehold: () => householdCtx,
}));

import { removeMember } from '@/lib/households';
import { showSuccessToast } from '@/lib/toast';

const ownerMember = {
  _id: 'm1',
  role: 'owner',
  userId: { _id: 'u1', username: 'owner', displayName: 'Owner One', email: 'owner@example.com' },
};
const adultMember = {
  _id: 'm2',
  role: 'adult',
  userId: { _id: 'u2', username: 'adult', displayName: 'Adult Two', email: 'adult@example.com' },
};

describe('HouseholdMembersList', () => {
  const refresh = vi.fn();

  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it('lists members with their names and roles', () => {
    householdCtx = { members: [ownerMember, adultMember], isOwner: false, refresh };

    render(<HouseholdMembersList />);

    expect(screen.getByText('Owner One')).toBeInTheDocument();
    expect(screen.getByText('Adult Two')).toBeInTheDocument();
    expect(screen.getByText('owner')).toBeInTheDocument();
    expect(screen.getByText('adult')).toBeInTheDocument();
  });

  it('shows no remove buttons for a non-owner', () => {
    householdCtx = { members: [ownerMember, adultMember], isOwner: false, refresh };

    render(<HouseholdMembersList />);

    expect(screen.queryByRole('button', { name: /Remove/ })).not.toBeInTheDocument();
  });

  it('lets an owner remove a non-owner member (with confirmation)', async () => {
    householdCtx = { members: [ownerMember, adultMember], isOwner: true, refresh };
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    vi.mocked(removeMember).mockResolvedValueOnce(undefined);
    const user = userEvent.setup();

    render(<HouseholdMembersList />);

    // The owner row has no remove button; only the adult does.
    expect(
      screen.queryByRole('button', { name: 'Remove Owner One' }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Remove Adult Two' }));

    await waitFor(() => {
      expect(removeMember).toHaveBeenCalledWith('m2');
    });
    expect(refresh).toHaveBeenCalled();
    expect(showSuccessToast).toHaveBeenCalledWith('Member removed.');
  });

  it('does not remove when confirmation is declined', async () => {
    householdCtx = { members: [ownerMember, adultMember], isOwner: true, refresh };
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    const user = userEvent.setup();

    render(<HouseholdMembersList />);
    await user.click(screen.getByRole('button', { name: 'Remove Adult Two' }));

    expect(removeMember).not.toHaveBeenCalled();
  });
});
