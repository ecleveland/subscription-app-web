import { render, screen } from '@testing-library/react';
import HouseholdPage from '../page';

let ctx: Record<string, unknown>;
vi.mock('@/lib/household-context', () => ({
  useHousehold: () => ctx,
}));

// Stub the child components; this spec only verifies the page's gating logic.
vi.mock('@/components/HouseholdSettingsForm', () => ({
  default: () => <div>SettingsForm</div>,
}));
vi.mock('@/components/HouseholdMembersList', () => ({
  default: () => <div>MembersList</div>,
}));
vi.mock('@/components/InviteMemberForm', () => ({
  default: () => <div>InviteForm</div>,
}));

const household = { _id: 'h1', name: 'HH', currency: 'USD', ownerId: 'u1' };

describe('HouseholdPage', () => {
  it('shows a loading state', () => {
    ctx = { loading: true, household: null };
    render(<HouseholdPage />);
    expect(screen.getByText('Loading household...')).toBeInTheDocument();
  });

  it('shows the error/empty state when there is no household', () => {
    ctx = { loading: false, household: null, error: 'Failed to load household' };
    render(<HouseholdPage />);
    expect(screen.getByText('Failed to load household')).toBeInTheDocument();
    expect(screen.queryByText('MembersList')).not.toBeInTheDocument();
  });

  it('renders the invite form for an owner', () => {
    ctx = { loading: false, household, isOwner: true };
    render(<HouseholdPage />);
    expect(screen.getByText('SettingsForm')).toBeInTheDocument();
    expect(screen.getByText('MembersList')).toBeInTheDocument();
    expect(screen.getByText('InviteForm')).toBeInTheDocument();
  });

  it('hides the invite form for a non-owner', () => {
    ctx = { loading: false, household, isOwner: false };
    render(<HouseholdPage />);
    expect(screen.getByText('MembersList')).toBeInTheDocument();
    expect(screen.queryByText('InviteForm')).not.toBeInTheDocument();
  });
});
