import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ChangePasswordForm from '../ChangePasswordForm';

vi.mock('@/lib/api', () => ({
  apiFetch: vi.fn(),
}));

vi.mock('@/lib/toast', () => ({
  showErrorToast: vi.fn(),
  showSuccessToast: vi.fn(),
}));

import { apiFetch } from '@/lib/api';
import { showErrorToast, showSuccessToast } from '@/lib/toast';

describe('ChangePasswordForm', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should show validation error when passwords do not match', async () => {
    const user = userEvent.setup();
    render(<ChangePasswordForm />);

    await user.type(screen.getByLabelText('Current Password'), 'oldpass12');
    await user.type(screen.getByLabelText('New Password'), 'newpass12');
    await user.type(screen.getByLabelText('Confirm New Password'), 'different');

    await user.click(screen.getByRole('button', { name: 'Change Password' }));

    expect(screen.getByText('New passwords do not match.')).toBeInTheDocument();
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it('should show validation error when password is too short', async () => {
    const user = userEvent.setup();
    render(<ChangePasswordForm />);

    await user.type(screen.getByLabelText('Current Password'), 'oldpass12');
    await user.type(screen.getByLabelText('New Password'), 'short');
    await user.type(screen.getByLabelText('Confirm New Password'), 'short');

    await user.click(screen.getByRole('button', { name: 'Change Password' }));

    expect(screen.getByText('New password must be at least 8 characters.')).toBeInTheDocument();
  });

  it('should show success toast on successful password change', async () => {
    const user = userEvent.setup();
    vi.mocked(apiFetch).mockResolvedValueOnce(undefined);

    render(<ChangePasswordForm />);

    await user.type(screen.getByLabelText('Current Password'), 'oldpass12');
    await user.type(screen.getByLabelText('New Password'), 'newpass12');
    await user.type(screen.getByLabelText('Confirm New Password'), 'newpass12');

    await user.click(screen.getByRole('button', { name: 'Change Password' }));

    await waitFor(() => {
      expect(showSuccessToast).toHaveBeenCalledWith('Password changed successfully.');
    });

    // Fields should be cleared
    expect(screen.getByLabelText('Current Password')).toHaveValue('');
    expect(screen.getByLabelText('New Password')).toHaveValue('');
    expect(screen.getByLabelText('Confirm New Password')).toHaveValue('');
  });

  it('should show error toast and inline error on API failure', async () => {
    const user = userEvent.setup();
    vi.mocked(apiFetch).mockRejectedValueOnce(new Error('Wrong password'));

    render(<ChangePasswordForm />);

    await user.type(screen.getByLabelText('Current Password'), 'oldpass12');
    await user.type(screen.getByLabelText('New Password'), 'newpass12');
    await user.type(screen.getByLabelText('Confirm New Password'), 'newpass12');

    await user.click(screen.getByRole('button', { name: 'Change Password' }));

    await waitFor(() => {
      expect(showErrorToast).toHaveBeenCalledWith('Wrong password');
      expect(screen.getByText('Wrong password')).toBeInTheDocument();
    });
  });
});
