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

  it('should clear storage and throw Unauthorized on 401', async () => {
    window.localStorage.setItem('token', 'expired-jwt');
    window.localStorage.setItem('user', '{}');
    mockFetch.mockResolvedValue({
      ok: false,
      status: 401,
    });

    await expect(apiFetch('/subscriptions')).rejects.toThrow('Unauthorized');

    expect(window.localStorage.getItem('token')).toBeNull();
    expect(window.localStorage.getItem('user')).toBeNull();
    // jsdom doesn't support navigation, but the code sets window.location.href = '/login'
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
