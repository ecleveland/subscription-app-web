import type { CookieOptions } from 'express';

/** httpOnly cookie holding the opaque refresh token. */
export const REFRESH_COOKIE = 'refresh_token';

const REFRESH_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days, matches token TTL

// Scope the cookie to the auth routes so it's only ever sent to /api/auth/*.
const REFRESH_COOKIE_PATH = '/api/auth';

/**
 * Cookie attributes for the refresh token. In production the frontend and
 * backend live on different Railway subdomains (cross-site), so the cookie must
 * be `SameSite=None; Secure` to be sent on credentialed cross-site requests; in
 * development (same-site http://localhost) `Lax` works and `Secure` would drop
 * the cookie over http.
 */
export function refreshCookieOptions(isProd: boolean): CookieOptions {
  return {
    httpOnly: true,
    secure: isProd,
    sameSite: isProd ? 'none' : 'lax',
    path: REFRESH_COOKIE_PATH,
    maxAge: REFRESH_MAX_AGE_MS,
  };
}

/** Matching attributes (sans maxAge) required to clear the cookie. */
export function clearRefreshCookieOptions(isProd: boolean): CookieOptions {
  return {
    httpOnly: true,
    secure: isProd,
    sameSite: isProd ? 'none' : 'lax',
    path: REFRESH_COOKIE_PATH,
  };
}
