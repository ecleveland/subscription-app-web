const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api';

// Readable cookie mirroring the access token, used only by the Next.js
// middleware to gate navigation (real auth is the backend Bearer check). The
// long-lived refresh token lives in an httpOnly cookie the backend manages.
const ACCESS_COOKIE = 'access_token';

let refreshPromise: Promise<string> | null = null;

/** Persist the access token to localStorage (for the Bearer header) and to the
 *  readable cookie the middleware inspects. */
export function setAccessToken(token: string): void {
  localStorage.setItem('token', token);
  const secure = window.location.protocol === 'https:' ? '; Secure' : '';
  document.cookie = `${ACCESS_COOKIE}=${token}; path=/; SameSite=Lax${secure}`;
}

/** Clear all client-side auth state (no redirect). */
export function clearStoredAuth(): void {
  localStorage.removeItem('token');
  localStorage.removeItem('user');
  document.cookie = `${ACCESS_COOKIE}=; path=/; max-age=0; SameSite=Lax`;
}

function clearAuthStateAndRedirect(): void {
  clearStoredAuth();
  window.location.href = '/login';
}

async function refreshAccessToken(): Promise<string> {
  // The refresh token rides along in the httpOnly cookie via credentials.
  const res = await fetch(`${API_URL}/auth/refresh`, {
    method: 'POST',
    credentials: 'include',
  });

  if (!res.ok) {
    throw new Error('Refresh failed');
  }

  const data = await res.json();
  setAccessToken(data.access_token);
  return data.access_token;
}

export async function apiFetch<T = unknown>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const token =
    typeof window !== 'undefined' ? localStorage.getItem('token') : null;

  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });

  if (res.status === 401) {
    if (typeof window === 'undefined') {
      throw new Error('Unauthorized');
    }

    let newToken: string;
    try {
      // Mutex so concurrent 401s only trigger one refresh.
      if (!refreshPromise) {
        refreshPromise = refreshAccessToken().finally(() => {
          refreshPromise = null;
        });
      }
      newToken = await refreshPromise;
    } catch {
      // Only a genuine refresh-acquisition failure means the session is dead.
      clearAuthStateAndRedirect();
      throw new Error('Session expired. Please log in again.');
    }

    // Retry OUTSIDE the auth-failure catch so the retried request's real
    // errors (a network blip, a 403/500, a malformed body) surface verbatim
    // instead of being relabeled as "Unauthorized" and forcing a spurious
    // logout.
    const retryRes = await fetch(`${API_URL}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${newToken}`,
        ...options.headers,
      },
    });

    if (!retryRes.ok) {
      const body = await retryRes.json().catch(() => ({}));
      throw new Error(body.message || `API error: ${retryRes.status}`);
    }

    if (retryRes.status === 204) {
      return undefined as T;
    }

    return retryRes.json();
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message || `API error: ${res.status}`);
  }

  if (res.status === 204) {
    return undefined as T;
  }

  return res.json();
}
