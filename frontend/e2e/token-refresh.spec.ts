import { test, expect } from '@playwright/test';

// Runs authenticated (default chromium project / USER storageState), which
// includes the httpOnly refresh cookie saved during setup.
test.describe('Access-token refresh', () => {
  test('transparently refreshes via the httpOnly cookie on a 401', async ({
    page,
  }) => {
    await page.goto('/');
    await expect(page.getByRole('button', { name: 'Logout' })).toBeVisible();

    // Corrupt only the localStorage access token so the next API call 401s.
    // The refresh cookie (still valid) should drive a transparent recovery;
    // the readable access_token cookie keeps the middleware from redirecting.
    await page.evaluate(() =>
      localStorage.setItem('token', 'invalid.jwt.token'),
    );

    // Reload to fire authenticated dashboard requests with the bad token.
    await page.reload();

    // Not bounced to /login — the 401 was refreshed and the request retried.
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole('button', { name: 'Logout' })).toBeVisible();

    // A fresh access token replaced the corrupted one. Poll, since the refresh
    // happens asynchronously after the page's authenticated requests 401 —
    // reading localStorage once can race the refresh under load.
    await expect
      .poll(() => page.evaluate(() => localStorage.getItem('token')))
      .not.toBe('invalid.jwt.token');
    const token = await page.evaluate(() => localStorage.getItem('token'));
    expect(token).toBeTruthy();
  });
});
