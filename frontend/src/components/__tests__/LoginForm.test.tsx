import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import LoginForm from '../LoginForm';

const mockLogin = vi.fn();
let mockSearchParams = new URLSearchParams();

vi.mock('next/navigation', () => ({
  useSearchParams: () => mockSearchParams,
}));

vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({
    login: mockLogin,
    isAuthenticated: false,
    user: null,
    isAdmin: false,
    register: vi.fn(),
    logout: vi.fn(),
    refreshProfile: vi.fn(),
  }),
}));

describe('LoginForm', () => {
  afterEach(() => {
    mockLogin.mockClear();
    mockSearchParams = new URLSearchParams();
  });

  it('should render username and password inputs', () => {
    render(<LoginForm />);

    expect(screen.getByLabelText('Username')).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toBeInTheDocument();
  });

  it('should render Sign In button', () => {
    render(<LoginForm />);
    expect(screen.getByRole('button', { name: 'Sign In' })).toBeInTheDocument();
  });

  it('should contain link to register page', () => {
    render(<LoginForm />);
    expect(screen.getByRole('link', { name: 'Create one' })).toHaveAttribute(
      'href',
      '/register',
    );
  });

  it('should contain "Forgot password?" link to /forgot-password', () => {
    render(<LoginForm />);
    expect(
      screen.getByRole('link', { name: 'Forgot password?' }),
    ).toHaveAttribute('href', '/forgot-password');
  });

  it('should call login with username and password on submit', async () => {
    const user = userEvent.setup();
    mockLogin.mockResolvedValue(undefined);

    render(<LoginForm />);

    await user.type(screen.getByLabelText('Username'), 'testuser');
    await user.type(screen.getByLabelText('Password'), 'password123');
    await user.click(screen.getByRole('button', { name: 'Sign In' }));

    await waitFor(() => {
      expect(mockLogin).toHaveBeenCalledWith('testuser', 'password123', null);
    });
  });

  it('should show error message on login failure', async () => {
    const user = userEvent.setup();
    mockLogin.mockRejectedValue(new Error('Invalid credentials'));

    render(<LoginForm />);

    await user.type(screen.getByLabelText('Username'), 'bad');
    await user.type(screen.getByLabelText('Password'), 'wrong');
    await user.click(screen.getByRole('button', { name: 'Sign In' }));

    await waitFor(() => {
      expect(
        screen.getByText('Invalid credentials. Please try again.'),
      ).toBeInTheDocument();
    });
  });

  it('should show Signing in... during loading', async () => {
    const user = userEvent.setup();
    mockLogin.mockImplementation(
      () => new Promise(() => {}), // never resolves
    );

    render(<LoginForm />);

    await user.type(screen.getByLabelText('Username'), 'test');
    await user.type(screen.getByLabelText('Password'), 'password');
    await user.click(screen.getByRole('button', { name: 'Sign In' }));

    expect(
      screen.getByRole('button', { name: 'Signing in...' }),
    ).toBeDisabled();
  });

  it('should pass the ?redirect target to login on submit', async () => {
    mockSearchParams = new URLSearchParams({
      redirect: '/household/accept?token=abc',
    });
    const user = userEvent.setup();
    mockLogin.mockResolvedValue(undefined);

    render(<LoginForm />);

    await user.type(screen.getByLabelText('Username'), 'testuser');
    await user.type(screen.getByLabelText('Password'), 'password123');
    await user.click(screen.getByRole('button', { name: 'Sign In' }));

    await waitFor(() => {
      expect(mockLogin).toHaveBeenCalledWith(
        'testuser',
        'password123',
        '/household/accept?token=abc',
      );
    });
  });

  it('should carry the ?redirect target on the register link', () => {
    mockSearchParams = new URLSearchParams({
      redirect: '/household/accept?token=abc',
    });
    render(<LoginForm />);
    expect(screen.getByRole('link', { name: 'Create one' })).toHaveAttribute(
      'href',
      '/register?redirect=%2Fhousehold%2Faccept%3Ftoken%3Dabc',
    );
  });
});
