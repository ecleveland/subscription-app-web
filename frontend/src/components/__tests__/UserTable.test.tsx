import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import UserTable from '../admin/UserTable';
import type { User } from '@/lib/types';

vi.mock('@/lib/api', () => ({
  apiFetch: vi.fn(),
}));

const { apiFetch } = await import('@/lib/api');
const mockApiFetch = apiFetch as ReturnType<typeof vi.fn>;

const mockUsers: User[] = [
  {
    _id: '1',
    username: 'alice',
    displayName: 'Alice Smith',
    email: 'alice@example.com',
    role: 'admin',
    createdAt: '2025-01-15T00:00:00.000Z',
    updatedAt: '2025-01-15T00:00:00.000Z',
  },
  {
    _id: '2',
    username: 'bob',
    role: 'user',
    createdAt: '2025-02-01T00:00:00.000Z',
    updatedAt: '2025-02-01T00:00:00.000Z',
  },
];

describe('UserTable', () => {
  const mockOnUserDeleted = vi.fn();

  beforeEach(() => {
    mockOnUserDeleted.mockClear();
    mockApiFetch.mockClear();
  });

  it('should render usernames for all users', () => {
    render(<UserTable users={mockUsers} onUserDeleted={mockOnUserDeleted} />);

    expect(screen.getAllByText('alice').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('bob').length).toBeGreaterThanOrEqual(1);
  });

  it('should render role badges', () => {
    render(<UserTable users={mockUsers} onUserDeleted={mockOnUserDeleted} />);

    expect(screen.getAllByText('admin').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('user').length).toBeGreaterThanOrEqual(1);
  });

  it('should render optional display name and email when present', () => {
    render(<UserTable users={mockUsers} onUserDeleted={mockOnUserDeleted} />);

    expect(screen.getAllByText('Alice Smith').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('alice@example.com').length).toBeGreaterThanOrEqual(1);
  });

  it('should call API and onUserDeleted when delete is confirmed', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    mockApiFetch.mockResolvedValue(undefined);

    const user = userEvent.setup();
    render(<UserTable users={mockUsers} onUserDeleted={mockOnUserDeleted} />);

    const deleteButtons = screen.getAllByText('Delete');
    await user.click(deleteButtons[0]);

    await waitFor(() => {
      expect(mockApiFetch).toHaveBeenCalledWith('/admin/users/1', { method: 'DELETE' });
      expect(mockOnUserDeleted).toHaveBeenCalledWith('1');
    });
  });

  it('should not delete when confirm is cancelled', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);

    const user = userEvent.setup();
    render(<UserTable users={mockUsers} onUserDeleted={mockOnUserDeleted} />);

    const deleteButtons = screen.getAllByText('Delete');
    await user.click(deleteButtons[0]);

    expect(mockApiFetch).not.toHaveBeenCalled();
    expect(mockOnUserDeleted).not.toHaveBeenCalled();
  });
});
