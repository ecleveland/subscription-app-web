import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ResetPasswordForm from '../ResetPasswordForm';

const mockApiFetch = vi.fn();
const mockShowSuccessToast = vi.fn();
const mockShowErrorToast = vi.fn();

let mockSearchParams = new URLSearchParams('token=test-token');

vi.mock('@/lib/api', () => ({
  apiFetch: (...args: unknown[]) => mockApiFetch(...args),
}));

vi.mock('@/lib/toast', () => ({
  showSuccessToast: (...args: unknown[]) => mockShowSuccessToast(...args),
  showErrorToast: (...args: unknown[]) => mockShowErrorToast(...args),
}));

vi.mock('next/navigation', () => ({
  useSearchParams: () => mockSearchParams,
}));

describe('ResetPasswordForm', () => {
  afterEach(() => {
    vi.clearAllMocks();
    mockSearchParams = new URLSearchParams('token=test-token');
  });

  it('should render password and confirm password inputs', () => {
    render(<ResetPasswordForm />);

    expect(screen.getByLabelText('New Password')).toBeInTheDocument();
    expect(screen.getByLabelText('Confirm Password')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Reset Password' }),
    ).toBeInTheDocument();
  });

  it('should show error when no token is in URL', () => {
    mockSearchParams = new URLSearchParams('');
    render(<ResetPasswordForm />);

    expect(
      screen.getByText('No reset token found. Please use the link from your email.'),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Request a new reset link' }),
    ).toHaveAttribute('href', '/forgot-password');
  });

  it('should show error when passwords do not match', async () => {
    const user = userEvent.setup();
    render(<ResetPasswordForm />);

    await user.type(screen.getByLabelText('New Password'), 'password123');
    await user.type(screen.getByLabelText('Confirm Password'), 'different123');
    await user.click(screen.getByRole('button', { name: 'Reset Password' }));

    expect(screen.getByText('Passwords do not match.')).toBeInTheDocument();
    expect(mockApiFetch).not.toHaveBeenCalled();
  });

  it('should submit and show success message', async () => {
    const user = userEvent.setup();
    mockApiFetch.mockResolvedValue({ message: 'ok' });

    render(<ResetPasswordForm />);

    await user.type(screen.getByLabelText('New Password'), 'newpassword123');
    await user.type(
      screen.getByLabelText('Confirm Password'),
      'newpassword123',
    );
    await user.click(screen.getByRole('button', { name: 'Reset Password' }));

    await waitFor(() => {
      expect(
        screen.getByText('Your password has been successfully reset.'),
      ).toBeInTheDocument();
    });

    expect(mockApiFetch).toHaveBeenCalledWith('/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify({ token: 'test-token', password: 'newpassword123' }),
    });
    expect(mockShowSuccessToast).toHaveBeenCalledWith(
      'Your password has been successfully reset.',
    );
    expect(
      screen.getByRole('link', { name: 'Go to login' }),
    ).toHaveAttribute('href', '/login');
  });

  it('should show error toast on API failure', async () => {
    const user = userEvent.setup();
    mockApiFetch.mockRejectedValue(
      new Error('Invalid or expired password reset token'),
    );

    render(<ResetPasswordForm />);

    await user.type(screen.getByLabelText('New Password'), 'newpassword123');
    await user.type(
      screen.getByLabelText('Confirm Password'),
      'newpassword123',
    );
    await user.click(screen.getByRole('button', { name: 'Reset Password' }));

    await waitFor(() => {
      expect(mockShowErrorToast).toHaveBeenCalledWith(
        'Invalid or expired password reset token',
      );
    });
  });

  it('should show "Resetting..." during loading', async () => {
    const user = userEvent.setup();
    mockApiFetch.mockImplementation(() => new Promise(() => {}));

    render(<ResetPasswordForm />);

    await user.type(screen.getByLabelText('New Password'), 'newpassword123');
    await user.type(
      screen.getByLabelText('Confirm Password'),
      'newpassword123',
    );
    await user.click(screen.getByRole('button', { name: 'Reset Password' }));

    expect(
      screen.getByRole('button', { name: 'Resetting...' }),
    ).toBeDisabled();
  });
});
