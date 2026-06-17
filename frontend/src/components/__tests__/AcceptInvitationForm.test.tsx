import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AcceptInvitationForm from '../AcceptInvitationForm';

vi.mock('@/lib/households', () => ({
  acceptInvitation: vi.fn(),
}));

vi.mock('@/lib/toast', () => ({
  showErrorToast: vi.fn(),
  showSuccessToast: vi.fn(),
}));

const refresh = vi.fn();
vi.mock('@/lib/household-context', () => ({
  useHousehold: () => ({ refresh }),
}));

const mockPush = vi.fn();
let tokenParam: string | null;
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
  useSearchParams: () => ({
    get: (key: string) => (key === 'token' ? tokenParam : null),
  }),
}));

import { acceptInvitation } from '@/lib/households';
import { showErrorToast, showSuccessToast } from '@/lib/toast';

describe('AcceptInvitationForm', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('accepts the invitation and redirects to the household page', async () => {
    tokenParam = 'raw-token-123';
    vi.mocked(acceptInvitation).mockResolvedValueOnce({} as never);
    const user = userEvent.setup();

    render(<AcceptInvitationForm />);
    await user.click(screen.getByRole('button', { name: 'Accept Invitation' }));

    await waitFor(() => {
      expect(acceptInvitation).toHaveBeenCalledWith('raw-token-123');
    });
    expect(refresh).toHaveBeenCalled();
    expect(showSuccessToast).toHaveBeenCalledWith(
      'You have joined the household.',
    );
    expect(mockPush).toHaveBeenCalledWith('/household');
  });

  it('shows an error message when no token is present', () => {
    tokenParam = null;

    render(<AcceptInvitationForm />);

    expect(
      screen.getByText(
        'No invitation token found. Please use the link from your email.',
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Accept Invitation' }),
    ).not.toBeInTheDocument();
  });

  it('surfaces an API error and does not redirect', async () => {
    tokenParam = 'bad-token';
    vi.mocked(acceptInvitation).mockRejectedValueOnce(
      new Error('Invalid or expired invitation'),
    );
    const user = userEvent.setup();

    render(<AcceptInvitationForm />);
    await user.click(screen.getByRole('button', { name: 'Accept Invitation' }));

    await waitFor(() => {
      expect(showErrorToast).toHaveBeenCalledWith(
        'Invalid or expired invitation',
      );
      expect(
        screen.getByText('Invalid or expired invitation'),
      ).toBeInTheDocument();
    });
    expect(mockPush).not.toHaveBeenCalled();
  });
});
