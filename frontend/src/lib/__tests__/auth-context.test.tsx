import { renderHook, act, waitFor } from '@testing-library/react';
import { AuthProvider, useAuth } from '../auth-context';

const mockPush = vi.fn();

// Override the global next/navigation mock with our tracked mockPush
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

// Create a valid JWT for testing (header.payload.signature)
function createMockJwt(payload: Record<string, unknown>): string {
  const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = btoa(JSON.stringify(payload));
  return `${header}.${body}.fake-signature`;
}

describe('useAuth', () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.cookie = 'auth-flag=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT';
    global.fetch = vi.fn();
    mockPush.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function renderAuthHook() {
    return renderHook(() => useAuth(), {
      wrapper: ({ children }: { children: React.ReactNode }) => (
        <AuthProvider>{children}</AuthProvider>
      ),
    });
  }

  it('should throw when used outside AuthProvider', () => {
    // Suppress console.error for expected error
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => renderHook(() => useAuth())).toThrow(
      'useAuth must be used within an AuthProvider',
    );
    spy.mockRestore();
  });

  it('should be unauthenticated when no token in localStorage', async () => {
    const { result } = renderAuthHook();

    await waitFor(() => {
      expect(result.current.isAuthenticated).toBe(false);
      expect(result.current.user).toBeNull();
      expect(result.current.isAdmin).toBe(false);
    });
  });

  it('should hydrate as authenticated when token exists in localStorage', async () => {
    const userInfo = {
      userId: '123',
      username: 'testuser',
      role: 'user',
    };
    window.localStorage.setItem('token', 'some-jwt');
    window.localStorage.setItem('user', JSON.stringify(userInfo));

    const { result } = renderAuthHook();

    await waitFor(() => {
      expect(result.current.isAuthenticated).toBe(true);
      expect(result.current.user).toEqual(userInfo);
    });
  });

  it('should set isAdmin to true when user role is admin', async () => {
    const userInfo = {
      userId: '123',
      username: 'admin',
      role: 'admin',
    };
    window.localStorage.setItem('token', 'some-jwt');
    window.localStorage.setItem('user', JSON.stringify(userInfo));

    const { result } = renderAuthHook();

    await waitFor(() => {
      expect(result.current.isAdmin).toBe(true);
    });
  });

  it('should clear state and redirect on logout', async () => {
    window.localStorage.setItem('token', 'some-jwt');
    window.localStorage.setItem('refresh_token', 'some-refresh');
    window.localStorage.setItem(
      'user',
      JSON.stringify({ userId: '123', username: 'test', role: 'user' }),
    );

    // Mock the logout fetch call
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      status: 204,
    });

    const { result } = renderAuthHook();

    await waitFor(() => {
      expect(result.current.isAuthenticated).toBe(true);
    });

    await act(async () => {
      await result.current.logout();
    });

    expect(result.current.isAuthenticated).toBe(false);
    expect(result.current.user).toBeNull();
    expect(window.localStorage.getItem('token')).toBeNull();
    expect(window.localStorage.getItem('user')).toBeNull();
    expect(window.localStorage.getItem('refresh_token')).toBeNull();
    expect(mockPush).toHaveBeenCalledWith('/login');
  });

  it('should call backend logout endpoint on logout', async () => {
    window.localStorage.setItem('token', 'my-jwt');
    window.localStorage.setItem('refresh_token', 'my-refresh');
    window.localStorage.setItem(
      'user',
      JSON.stringify({ userId: '123', username: 'test', role: 'user' }),
    );

    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      status: 204,
    });

    const { result } = renderAuthHook();

    await waitFor(() => {
      expect(result.current.isAuthenticated).toBe(true);
    });

    await act(async () => {
      await result.current.logout();
    });

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/auth/logout'),
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer my-jwt',
        }),
        body: JSON.stringify({ refresh_token: 'my-refresh' }),
      }),
    );
  });

  it('should store token and refresh_token on successful login', async () => {
    const mockToken = createMockJwt({
      sub: '123',
      username: 'testuser',
      role: 'user',
    });

    (global.fetch as ReturnType<typeof vi.fn>)
      // login call
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            access_token: mockToken,
            refresh_token: 'login-refresh-token',
          }),
      })
      // fetchAndStoreProfile calls apiFetch('/users/me')
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            displayName: 'Test User',
            email: 'test@example.com',
          }),
      });

    const { result } = renderAuthHook();

    await waitFor(() => {
      expect(result.current.isAuthenticated).toBe(false);
    });

    await act(async () => {
      await result.current.login('testuser', 'password');
    });

    expect(window.localStorage.getItem('token')).toBe(mockToken);
    expect(window.localStorage.getItem('refresh_token')).toBe(
      'login-refresh-token',
    );
    expect(result.current.isAuthenticated).toBe(true);
    expect(mockPush).toHaveBeenCalledWith('/');
  });

  it('should store refresh_token on successful register', async () => {
    const mockToken = createMockJwt({
      sub: '456',
      username: 'newuser',
      role: 'user',
    });

    (global.fetch as ReturnType<typeof vi.fn>)
      // register call
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            access_token: mockToken,
            refresh_token: 'register-refresh-token',
          }),
      })
      // fetchAndStoreProfile calls apiFetch('/users/me')
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            displayName: 'New User',
            email: 'new@example.com',
          }),
      });

    const { result } = renderAuthHook();

    await waitFor(() => {
      expect(result.current.isAuthenticated).toBe(false);
    });

    await act(async () => {
      await result.current.register({
        username: 'newuser',
        password: 'password123',
      });
    });

    expect(window.localStorage.getItem('token')).toBe(mockToken);
    expect(window.localStorage.getItem('refresh_token')).toBe(
      'register-refresh-token',
    );
    expect(result.current.isAuthenticated).toBe(true);
  });

  it('should throw on failed login', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      json: () => Promise.resolve({ message: 'Invalid credentials' }),
    });

    const { result } = renderAuthHook();

    await waitFor(() => {
      expect(result.current.isAuthenticated).toBe(false);
    });

    await expect(
      act(async () => {
        await result.current.login('bad', 'wrong');
      }),
    ).rejects.toThrow('Invalid credentials');
  });

  it('should handle corrupted user data in localStorage gracefully', async () => {
    window.localStorage.setItem('token', 'some-jwt');
    window.localStorage.setItem('user', 'not-valid-json');

    const { result } = renderAuthHook();

    await waitFor(() => {
      expect(result.current.isAuthenticated).toBe(true);
      expect(result.current.user).toBeNull();
    });

    // Corrupted data should be cleaned up
    expect(window.localStorage.getItem('user')).toBeNull();
  });
});
