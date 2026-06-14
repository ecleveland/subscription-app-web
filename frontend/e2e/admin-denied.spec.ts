import { test, expect } from '@playwright/test';

// Runs under the `chromium` project (regular-user storageState).
test.describe('Admin access control', () => {
  test('non-admin user is redirected away from /admin/users', async ({ page }) => {
    await page.goto('/admin/users');

    // The page redirects non-admins back to the dashboard and renders nothing.
    await expect(page).toHaveURL(/\/$/);
    await expect(
      page.getByRole('heading', { name: 'User Management' }),
    ).toHaveCount(0);
  });
});
