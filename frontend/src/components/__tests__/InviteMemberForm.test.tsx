import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import InviteMemberForm from '../InviteMemberForm';

vi.mock('@/lib/households', () => ({
  inviteMember: vi.fn(),
}));

vi.mock('@/lib/toast', () => ({
  showErrorToast: vi.fn(),
  showSuccessToast: vi.fn(),
}));

import { inviteMember } from '@/lib/households';
import { showErrorToast, showSuccessToast } from '@/lib/toast';

const inviteResult = {
  id: 'i1',
  householdId: 'h1',
  email: 'guest@example.com',
  role: 'adult',
  status: 'pending',
  expiresAt: '2026-07-01T00:00:00.000Z',
  inviteUrl: 'http://localhost:3000/household/accept?token=raw-token-123',
};

describe('InviteMemberForm', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('invites by email and reveals the shareable invite link', async () => {
    vi.mocked(inviteMember).mockResolvedValueOnce(inviteResult as never);
    const user = userEvent.setup();

    render(<InviteMemberForm />);

    await user.type(screen.getByLabelText('Email'), 'guest@example.com');
    await user.click(screen.getByRole('button', { name: 'Send Invitation' }));

    await waitFor(() => {
      expect(inviteMember).toHaveBeenCalledWith({
        email: 'guest@example.com',
        role: 'adult',
      });
    });
    expect(showSuccessToast).toHaveBeenCalledWith(
      'Invitation sent to guest@example.com.',
    );
    expect(screen.getByLabelText('Invite link')).toHaveValue(
      inviteResult.inviteUrl,
    );
    // Email field is cleared after a successful invite.
    expect(screen.getByLabelText('Email')).toHaveValue('');
  });

  it('sends the selected role', async () => {
    vi.mocked(inviteMember).mockResolvedValueOnce(inviteResult as never);
    const user = userEvent.setup();

    render(<InviteMemberForm />);

    await user.type(screen.getByLabelText('Email'), 'teen@example.com');
    await user.selectOptions(screen.getByLabelText('Role'), 'teen');
    await user.click(screen.getByRole('button', { name: 'Send Invitation' }));

    await waitFor(() => {
      expect(inviteMember).toHaveBeenCalledWith({
        email: 'teen@example.com',
        role: 'teen',
      });
    });
  });

  it('validates that an email is provided', async () => {
    const user = userEvent.setup();

    render(<InviteMemberForm />);
    await user.click(screen.getByRole('button', { name: 'Send Invitation' }));

    expect(screen.getByText('Email is required.')).toBeInTheDocument();
    expect(inviteMember).not.toHaveBeenCalled();
  });

  it('shows an error toast when the invite fails', async () => {
    vi.mocked(inviteMember).mockRejectedValueOnce(
      new Error('That user is already a member of this household'),
    );
    const user = userEvent.setup();

    render(<InviteMemberForm />);
    await user.type(screen.getByLabelText('Email'), 'dupe@example.com');
    await user.click(screen.getByRole('button', { name: 'Send Invitation' }));

    await waitFor(() => {
      expect(showErrorToast).toHaveBeenCalledWith(
        'That user is already a member of this household',
      );
    });
  });
});
