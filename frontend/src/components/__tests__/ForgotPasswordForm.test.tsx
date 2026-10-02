import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ForgotPasswordForm from '../ForgotPasswordForm';

const mockApiFetch = vi.fn();
const mockShowErrorToast = vi.fn();
let mockSearchParams = new URLSearchParams();

vi.mock('next/navigation', () => ({
  useSearchParams: () => mockSearchParams,
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    prefetch: vi.fn(),
  }),
  useParams: () => ({}),
}));

vi.mock('@/lib/api', () => ({
  apiFetch: (...args: unknown[]) => mockApiFetch(...args),
}));

vi.mock('@/lib/toast', () => ({
  showErrorToast: (...args: unknown[]) => mockShowErrorToast(...args),
  showSuccessToast: vi.fn(),
}));

describe('ForgotPasswordForm', () => {
  afterEach(() => {
    vi.clearAllMocks();
    mockSearchParams = new URLSearchParams();
  });

  it('should render the email input and submit button', () => {
    render(<ForgotPasswordForm />);

    expect(screen.getByLabelText('Email')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Send Reset Link' }),
    ).toBeInTheDocument();
  });

  it('should have a "Back to login" link', () => {
    render(<ForgotPasswordForm />);

    const link = screen.getByRole('link', { name: 'Back to login' });
    expect(link).toHaveAttribute('href', '/login');
  });

  it('should carry the ?redirect target on the "Back to login" link', () => {
    mockSearchParams = new URLSearchParams('redirect=/household/accept?token=abc');
    render(<ForgotPasswordForm />);

    expect(
      screen.getByRole('link', { name: 'Back to login' }),
    ).toHaveAttribute(
      'href',
      '/login?redirect=%2Fhousehold%2Faccept%3Ftoken%3Dabc',
    );
  });

  it('should carry the ?redirect target on the confirmation "Back to login" link', async () => {
    const user = userEvent.setup();
    mockApiFetch.mockResolvedValue({ message: 'ok' });
    mockSearchParams = new URLSearchParams('redirect=/household/accept?token=abc');

    render(<ForgotPasswordForm />);

    await user.type(screen.getByLabelText('Email'), 'test@example.com');
    await user.click(
      screen.getByRole('button', { name: 'Send Reset Link' }),
    );

    await waitFor(() => {
      expect(
        screen.getByText(
          'If an account with that email exists, a reset link has been sent.',
        ),
      ).toBeInTheDocument();
    });

    expect(
      screen.getByRole('link', { name: 'Back to login' }),
    ).toHaveAttribute(
      'href',
      '/login?redirect=%2Fhousehold%2Faccept%3Ftoken%3Dabc',
    );
  });

  it('should show confirmation message after successful submit', async () => {
    const user = userEvent.setup();
    mockApiFetch.mockResolvedValue({ message: 'ok' });

    render(<ForgotPasswordForm />);

    await user.type(screen.getByLabelText('Email'), 'test@example.com');
    await user.click(
      screen.getByRole('button', { name: 'Send Reset Link' }),
    );

    await waitFor(() => {
      expect(
        screen.getByText(
          'If an account with that email exists, a reset link has been sent.',
        ),
      ).toBeInTheDocument();
    });

    expect(mockApiFetch).toHaveBeenCalledWith('/auth/forgot-password', {
      method: 'POST',
      body: JSON.stringify({ email: 'test@example.com' }),
    });
  });

  it('should show error toast on failure', async () => {
    const user = userEvent.setup();
    mockApiFetch.mockRejectedValue(new Error('Network error'));

    render(<ForgotPasswordForm />);

    await user.type(screen.getByLabelText('Email'), 'test@example.com');
    await user.click(
      screen.getByRole('button', { name: 'Send Reset Link' }),
    );

    await waitFor(() => {
      expect(mockShowErrorToast).toHaveBeenCalledWith('Network error');
    });
  });

  it('should show "Sending..." during loading', async () => {
    const user = userEvent.setup();
    mockApiFetch.mockImplementation(() => new Promise(() => {}));

    render(<ForgotPasswordForm />);

    await user.type(screen.getByLabelText('Email'), 'test@example.com');
    await user.click(
      screen.getByRole('button', { name: 'Send Reset Link' }),
    );

    expect(
      screen.getByRole('button', { name: 'Sending...' }),
    ).toBeDisabled();
  });
});
