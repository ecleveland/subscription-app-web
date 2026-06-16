import {
  REFRESH_COOKIE,
  refreshCookieOptions,
  clearRefreshCookieOptions,
} from './cookie.config';

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

describe('cookie.config', () => {
  it('exposes the refresh cookie name', () => {
    expect(REFRESH_COOKIE).toBe('refresh_token');
  });

  describe('refreshCookieOptions', () => {
    it('uses Secure + SameSite=None in production (cross-site delivery)', () => {
      expect(refreshCookieOptions(true)).toEqual({
        httpOnly: true,
        secure: true,
        sameSite: 'none',
        path: '/api/auth',
        maxAge: SEVEN_DAYS_MS,
      });
    });

    it('uses Lax + insecure in development (same-site http localhost)', () => {
      expect(refreshCookieOptions(false)).toEqual({
        httpOnly: true,
        secure: false,
        sameSite: 'lax',
        path: '/api/auth',
        maxAge: SEVEN_DAYS_MS,
      });
    });
  });

  describe('clearRefreshCookieOptions', () => {
    it.each([true, false])(
      'matches set attributes (sans maxAge) so the browser clears the cookie (isProd=%s)',
      (isProd) => {
        const set = refreshCookieOptions(isProd);
        const clear = clearRefreshCookieOptions(isProd);

        expect(clear).toEqual({
          httpOnly: set.httpOnly,
          secure: set.secure,
          sameSite: set.sameSite,
          path: set.path,
        });
        expect(clear).not.toHaveProperty('maxAge');
      },
    );
  });
});
