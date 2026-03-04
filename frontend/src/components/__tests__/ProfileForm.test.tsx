import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ProfileForm from '../ProfileForm';

vi.mock('@/lib/api', () => ({
  apiFetch: vi.fn(),
}));

vi.mock('@/lib/toast', () => ({
  showErrorToast: vi.fn(),
  showSuccessToast: vi.fn(),
}));

const mockRefreshProfile = vi.fn();
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({
    user: {
      userId: '1',
      username: 'testuser',
      role: 'user',
      displayName: 'Test User',
      email: 'test@example.com',
      avatarUrl: '',
    },
    refreshProfile: mockRefreshProfile,
  }),
}));

import { apiFetch } from '@/lib/api';
import { showErrorToast, showSuccessToast } from '@/lib/toast';

describe('ProfileForm', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    mockRefreshProfile.mockClear();
  });

  it('should render form with user data pre-filled', () => {
    render(<ProfileForm />);

    expect(screen.getByLabelText('Username')).toHaveValue('testuser');
    expect(screen.getByLabelText('Display Name')).toHaveValue('Test User');
    expect(screen.getByLabelText('Email')).toHaveValue('test@example.com');
  });

  it('should show success toast on successful update', async () => {
    const user = userEvent.setup();
    vi.mocked(apiFetch).mockResolvedValueOnce({});
    mockRefreshProfile.mockResolvedValueOnce(undefined);

    render(<ProfileForm />);

    await user.click(screen.getByRole('button', { name: 'Save Changes' }));

    await waitFor(() => {
      expect(showSuccessToast).toHaveBeenCalledWith('Profile updated successfully.');
    });
  });

  it('should show error toast and inline error on failure', async () => {
    const user = userEvent.setup();
    vi.mocked(apiFetch).mockRejectedValueOnce(new Error('Update failed'));

    render(<ProfileForm />);

    await user.click(screen.getByRole('button', { name: 'Save Changes' }));

    await waitFor(() => {
      expect(showErrorToast).toHaveBeenCalledWith('Update failed');
      expect(screen.getByText('Update failed')).toBeInTheDocument();
    });
  });

  it('should not show inline success message', async () => {
    const user = userEvent.setup();
    vi.mocked(apiFetch).mockResolvedValueOnce({});
    mockRefreshProfile.mockResolvedValueOnce(undefined);

    render(<ProfileForm />);

    await user.click(screen.getByRole('button', { name: 'Save Changes' }));

    await waitFor(() => {
      expect(showSuccessToast).toHaveBeenCalled();
    });

    expect(screen.queryByText('Profile updated successfully.')).not.toBeInTheDocument();
  });
});
