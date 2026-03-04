import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AdminUserForm from '../admin/AdminUserForm';

vi.mock('@/lib/api', () => ({
  apiFetch: vi.fn(),
}));

vi.mock('@/lib/toast', () => ({
  showErrorToast: vi.fn(),
  showSuccessToast: vi.fn(),
}));

const mockPush = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
    replace: vi.fn(),
    back: vi.fn(),
    prefetch: vi.fn(),
  }),
  useParams: () => ({}),
  useSearchParams: () => new URLSearchParams(),
}));

import { apiFetch } from '@/lib/api';
import { showErrorToast, showSuccessToast } from '@/lib/toast';

describe('AdminUserForm', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    mockPush.mockClear();
  });

  it('should render form fields', () => {
    render(<AdminUserForm />);

    expect(screen.getByLabelText('Username')).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create User' })).toBeInTheDocument();
  });

  it('should show validation error for short password', async () => {
    const user = userEvent.setup();
    render(<AdminUserForm />);

    await user.type(screen.getByLabelText('Username'), 'newuser');
    await user.type(screen.getByLabelText('Password'), 'short');

    await user.click(screen.getByRole('button', { name: 'Create User' }));

    expect(screen.getByText('Password must be at least 8 characters.')).toBeInTheDocument();
  });

  it('should show success toast and navigate on successful creation', async () => {
    const user = userEvent.setup();
    vi.mocked(apiFetch).mockResolvedValueOnce({});

    render(<AdminUserForm />);

    await user.type(screen.getByLabelText('Username'), 'newuser');
    await user.type(screen.getByLabelText('Password'), 'password123');

    await user.click(screen.getByRole('button', { name: 'Create User' }));

    await waitFor(() => {
      expect(showSuccessToast).toHaveBeenCalledWith('User created');
      expect(mockPush).toHaveBeenCalledWith('/admin/users');
    });
  });

  it('should show error toast and inline error on API failure', async () => {
    const user = userEvent.setup();
    vi.mocked(apiFetch).mockRejectedValueOnce(new Error('Username taken'));

    render(<AdminUserForm />);

    await user.type(screen.getByLabelText('Username'), 'existinguser');
    await user.type(screen.getByLabelText('Password'), 'password123');

    await user.click(screen.getByRole('button', { name: 'Create User' }));

    await waitFor(() => {
      expect(showErrorToast).toHaveBeenCalledWith('Username taken');
      expect(screen.getByText('Username taken')).toBeInTheDocument();
    });
  });
});
