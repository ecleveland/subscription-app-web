import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Header from '../Header';

const mockLogout = vi.fn();

// We need to be able to vary the auth state between tests
let authState: Record<string, unknown>;

vi.mock('@/lib/auth-context', () => ({
  useAuth: () => authState,
}));

// Mock ThemeToggle since it depends on ThemeProvider
vi.mock('@/components/ThemeToggle', () => ({
  default: () => <button>ThemeToggle</button>,
}));

describe('Header', () => {
  afterEach(() => {
    mockLogout.mockClear();
  });

  it('should return null when not authenticated', () => {
    authState = {
      isAuthenticated: false,
      user: null,
      isAdmin: false,
      logout: mockLogout,
    };

    const { container } = render(<Header />);
    expect(container.innerHTML).toBe('');
  });

  it('should render navigation when authenticated', () => {
    authState = {
      isAuthenticated: true,
      user: { userId: '1', username: 'test', role: 'user' },
      isAdmin: false,
      logout: mockLogout,
    };

    render(<Header />);

    expect(screen.getByText('Subscriptions')).toBeInTheDocument();
    expect(screen.getByText('+ Add')).toBeInTheDocument();
    expect(screen.getByText('Profile')).toBeInTheDocument();
    expect(screen.getByText('Logout')).toBeInTheDocument();
  });

  it('should show Admin link when user is admin', () => {
    authState = {
      isAuthenticated: true,
      user: { userId: '1', username: 'admin', role: 'admin' },
      isAdmin: true,
      logout: mockLogout,
    };

    render(<Header />);

    expect(screen.getByText('Admin')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Admin' })).toHaveAttribute(
      'href',
      '/admin/users',
    );
  });

  it('should not show Admin link for regular users', () => {
    authState = {
      isAuthenticated: true,
      user: { userId: '1', username: 'test', role: 'user' },
      isAdmin: false,
      logout: mockLogout,
    };

    render(<Header />);

    expect(screen.queryByText('Admin')).not.toBeInTheDocument();
  });

  it('should call logout when Logout button is clicked', async () => {
    authState = {
      isAuthenticated: true,
      user: { userId: '1', username: 'test', role: 'user' },
      isAdmin: false,
      logout: mockLogout,
    };

    const user = userEvent.setup();
    render(<Header />);

    await user.click(screen.getByText('Logout'));

    expect(mockLogout).toHaveBeenCalled();
  });
});
