import { apiFetch } from '../api';

describe('apiFetch', () => {
  const mockFetch = vi.fn();

  beforeEach(() => {
    mockFetch.mockReset();
    global.fetch = mockFetch;
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should attach Authorization header when token exists', async () => {
    window.localStorage.setItem('token', 'my-jwt');
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ data: 'ok' }),
    });

    await apiFetch('/subscriptions');

    expect(mockFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer my-jwt',
        }),
      }),
    );
  });

  it('should not attach Authorization header when no token exists', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({}),
    });

    await apiFetch('/subscriptions');

    const headers = mockFetch.mock.calls[0][1].headers;
    expect(headers.Authorization).toBeUndefined();
  });

  it('should always set Content-Type to application/json', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({}),
    });

    await apiFetch('/subscriptions');

    expect(mockFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
        }),
      }),
    );
  });

  it('should attempt refresh on 401 when refresh_token exists, then retry original request', async () => {
    window.localStorage.setItem('token', 'expired-jwt');
    window.localStorage.setItem('refresh_token', 'valid-refresh');

    mockFetch
      // Original request → 401
      .mockResolvedValueOnce({ ok: false, status: 401 })
      // Refresh call → success
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            access_token: 'new-jwt',
            refresh_token: 'new-refresh',
          }),
      })
      // Retry original request → success
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ data: 'ok' }),
      });

    const result = await apiFetch('/subscriptions');

    expect(result).toEqual({ data: 'ok' });
    expect(window.localStorage.getItem('token')).toBe('new-jwt');
    expect(window.localStorage.getItem('refresh_token')).toBe('new-refresh');
    // 3 calls: original, refresh, retry
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it('should clear state and throw on 401 when no refresh_token exists', async () => {
    window.localStorage.setItem('token', 'expired-jwt');
    window.localStorage.setItem('user', '{}');
    mockFetch.mockResolvedValue({
      ok: false,
      status: 401,
    });

    await expect(apiFetch('/subscriptions')).rejects.toThrow('Unauthorized');

    expect(window.localStorage.getItem('token')).toBeNull();
    expect(window.localStorage.getItem('user')).toBeNull();
  });

  it('should clear state when refresh fails', async () => {
    window.localStorage.setItem('token', 'expired-jwt');
    window.localStorage.setItem('refresh_token', 'bad-refresh');
    window.localStorage.setItem('user', '{}');

    mockFetch
      // Original request → 401
      .mockResolvedValueOnce({ ok: false, status: 401 })
      // Refresh call → failure
      .mockResolvedValueOnce({ ok: false, status: 401 });

    await expect(apiFetch('/subscriptions')).rejects.toThrow('Unauthorized');

    expect(window.localStorage.getItem('token')).toBeNull();
    expect(window.localStorage.getItem('refresh_token')).toBeNull();
  });

  it('should only call refresh once for concurrent 401s', async () => {
    window.localStorage.setItem('token', 'expired-jwt');
    window.localStorage.setItem('refresh_token', 'valid-refresh');

    let refreshCallCount = 0;

    mockFetch.mockImplementation((url: string) => {
      if (url.includes('/auth/refresh')) {
        refreshCallCount++;
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              access_token: 'new-jwt',
              refresh_token: 'new-refresh',
            }),
        });
      }
      // First calls return 401, retry calls return success
      if (
        mockFetch.mock.calls.filter(
          (c: string[]) => c[0] === url && !c[0].includes('/auth/refresh'),
        ).length <= 1
      ) {
        return Promise.resolve({ ok: false, status: 401 });
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ data: 'ok' }),
      });
    });

    const [result1, result2] = await Promise.all([
      apiFetch('/subscriptions'),
      apiFetch('/users/me'),
    ]);

    expect(result1).toEqual({ data: 'ok' });
    expect(result2).toEqual({ data: 'ok' });
    // Refresh should have been called only once
    expect(refreshCallCount).toBe(1);
  });

  it('should throw with message from response body on non-ok', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 400,
      json: () => Promise.resolve({ message: 'Validation failed' }),
    });

    await expect(apiFetch('/subscriptions')).rejects.toThrow(
      'Validation failed',
    );
  });

  it('should throw generic error when response body is not parseable', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      json: () => Promise.reject(new Error('not json')),
    });

    await expect(apiFetch('/subscriptions')).rejects.toThrow('API error: 500');
  });

  it('should return undefined for 204 No Content responses', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 204,
    });

    const result = await apiFetch('/subscriptions/123');

    expect(result).toBeUndefined();
  });

  it('should return parsed JSON for 200 responses', async () => {
    const data = { name: 'Netflix', cost: 15.99 };
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(data),
    });

    const result = await apiFetch('/subscriptions');

    expect(result).toEqual(data);
  });

  it('should merge custom options with defaults', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({}),
    });

    await apiFetch('/subscriptions', {
      method: 'POST',
      body: JSON.stringify({ name: 'test' }),
    });

    expect(mockFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ name: 'test' }),
      }),
    );
  });
});
