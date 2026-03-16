import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import NotificationBell from '../NotificationBell';

const mockPush = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}));

vi.mock('@/lib/api', () => ({
  apiFetch: vi.fn(),
}));

import { apiFetch } from '@/lib/api';
const mockApiFetch = vi.mocked(apiFetch);

describe('NotificationBell', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApiFetch.mockResolvedValue({ count: 0 });
  });

  it('should render the bell icon', async () => {
    render(<NotificationBell />);
    expect(screen.getByLabelText('Notifications')).toBeInTheDocument();
  });

  it('should show badge when there are unread notifications', async () => {
    mockApiFetch.mockResolvedValue({ count: 3 });

    render(<NotificationBell />);

    await waitFor(() => {
      expect(screen.getByText('3')).toBeInTheDocument();
    });
  });

  it('should show 9+ when count exceeds 9', async () => {
    mockApiFetch.mockResolvedValue({ count: 15 });

    render(<NotificationBell />);

    await waitFor(() => {
      expect(screen.getByText('9+')).toBeInTheDocument();
    });
  });

  it('should open dropdown and show notifications on click', async () => {
    mockApiFetch
      .mockResolvedValueOnce({ count: 1 }) // initial poll
      .mockResolvedValueOnce({
        data: [
          {
            _id: 'n1',
            subscriptionId: 's1',
            type: 'renewal_reminder',
            title: 'Netflix renewing soon',
            message: 'Your Netflix subscription renews in 3 days.',
            read: false,
            billingDate: '2026-03-20',
            createdAt: new Date().toISOString(),
          },
        ],
        unreadCount: 1,
      });

    const user = userEvent.setup();
    render(<NotificationBell />);

    await waitFor(() => {
      expect(screen.getByText('1')).toBeInTheDocument();
    });

    await user.click(screen.getByLabelText('Notifications'));

    await waitFor(() => {
      expect(screen.getByText('Netflix renewing soon')).toBeInTheDocument();
      expect(
        screen.getByText(
          'Your Netflix subscription renews in 3 days.',
        ),
      ).toBeInTheDocument();
    });
  });

  it('should show "No notifications" when list is empty', async () => {
    mockApiFetch
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({ data: [], unreadCount: 0 });

    const user = userEvent.setup();
    render(<NotificationBell />);

    await user.click(screen.getByLabelText('Notifications'));

    await waitFor(() => {
      expect(screen.getByText('No notifications')).toBeInTheDocument();
    });
  });

  it('should mark notification as read and navigate on click', async () => {
    mockApiFetch
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({
        data: [
          {
            _id: 'n1',
            subscriptionId: 's1',
            type: 'renewal_reminder',
            title: 'Netflix renewing soon',
            message: 'Renews in 3 days.',
            read: false,
            billingDate: '2026-03-20',
            createdAt: new Date().toISOString(),
          },
        ],
        unreadCount: 1,
      })
      .mockResolvedValueOnce({ read: true }); // mark as read response

    const user = userEvent.setup();
    render(<NotificationBell />);

    await user.click(screen.getByLabelText('Notifications'));

    await waitFor(() => {
      expect(screen.getByText('Netflix renewing soon')).toBeInTheDocument();
    });

    await user.click(screen.getByText('Netflix renewing soon'));

    expect(mockApiFetch).toHaveBeenCalledWith('/notifications/n1/read', {
      method: 'PATCH',
    });
    expect(mockPush).toHaveBeenCalledWith('/subscriptions/s1/edit');
  });

  it('should mark all as read', async () => {
    mockApiFetch
      .mockResolvedValueOnce({ count: 2 })
      .mockResolvedValueOnce({
        data: [
          {
            _id: 'n1',
            subscriptionId: 's1',
            type: 'renewal_reminder',
            title: 'Netflix renewing soon',
            message: 'Renews in 3 days.',
            read: false,
            billingDate: '2026-03-20',
            createdAt: new Date().toISOString(),
          },
        ],
        unreadCount: 2,
      })
      .mockResolvedValueOnce(undefined); // mark all read response

    const user = userEvent.setup();
    render(<NotificationBell />);

    await user.click(screen.getByLabelText('Notifications'));

    await waitFor(() => {
      expect(screen.getByText('Mark all as read')).toBeInTheDocument();
    });

    await user.click(screen.getByText('Mark all as read'));

    expect(mockApiFetch).toHaveBeenCalledWith('/notifications/mark-all-read', {
      method: 'POST',
    });
  });

  it('should dismiss a notification', async () => {
    mockApiFetch
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({
        data: [
          {
            _id: 'n1',
            subscriptionId: 's1',
            type: 'renewal_reminder',
            title: 'Netflix renewing soon',
            message: 'Renews in 3 days.',
            read: false,
            billingDate: '2026-03-20',
            createdAt: new Date().toISOString(),
          },
        ],
        unreadCount: 1,
      })
      .mockResolvedValueOnce(undefined); // delete response

    const user = userEvent.setup();
    render(<NotificationBell />);

    await user.click(screen.getByLabelText('Notifications'));

    await waitFor(() => {
      expect(
        screen.getByLabelText('Dismiss notification'),
      ).toBeInTheDocument();
    });

    await user.click(screen.getByLabelText('Dismiss notification'));

    expect(mockApiFetch).toHaveBeenCalledWith('/notifications/n1', {
      method: 'DELETE',
    });
  });

  it('should close dropdown on click outside', async () => {
    mockApiFetch
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({ data: [], unreadCount: 0 });

    const user = userEvent.setup();
    render(
      <div>
        <NotificationBell />
        <div data-testid="outside">Outside</div>
      </div>,
    );

    await user.click(screen.getByLabelText('Notifications'));

    await waitFor(() => {
      expect(screen.getByText('No notifications')).toBeInTheDocument();
    });

    await user.click(screen.getByTestId('outside'));

    await waitFor(() => {
      expect(screen.queryByText('No notifications')).not.toBeInTheDocument();
    });
  });
});
