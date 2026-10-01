import { test, expect } from '@playwright/test';
import { USER } from './helpers';

// These flows must start logged out, so override the project's saved auth state.
test.use({ storageState: { cookies: [], origins: [] } });

test.describe('Authentication', () => {
  test('middleware redirects unauthenticated users to /login', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole('button', { name: 'Sign In' })).toBeVisible();
  });

  test('failed login shows an error message', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Username').fill('does-not-exist');
    await page.getByLabel('Password').fill('wrong-password');
    await page.getByRole('button', { name: 'Sign In' }).click();

    await expect(
      page.getByText('Invalid credentials. Please try again.'),
    ).toBeVisible();
    // Still on the login page.
    await expect(page).toHaveURL(/\/login$/);
  });

  test('register, land on dashboard, then logout', async ({ page }) => {
    const username = `e2e-reg-${Date.now()}`;
    const password = 'e2e-Password123';

    await page.goto('/register');
    await page.getByLabel('Username').fill(username);
    await page.getByLabel('Password', { exact: true }).fill(password);
    await page.getByLabel('Confirm Password').fill(password);
    await page.getByRole('button', { name: 'Create Account' }).click();

    // Registration auto-authenticates and redirects to the dashboard.
    await expect(page).toHaveURL(/\/$/);
    const logout = page.getByRole('button', { name: 'Logout' });
    await expect(logout).toBeVisible();

    await logout.click();
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole('button', { name: 'Logout' })).toHaveCount(0);
  });

  test('login returns the user to the protected deep link they asked for', async ({
    page,
  }) => {
    await page.goto('/household/accept?token=abc');
    await expect(page).toHaveURL(/\/login\?redirect=/);

    await page.getByLabel('Username').fill(USER.username);
    await page.getByLabel('Password').fill(USER.password);
    await page.getByRole('button', { name: 'Sign In' }).click();

    await expect(page).toHaveURL(/\/household\/accept\?token=abc$/);
    await expect(
      page.getByRole('button', { name: 'Accept Invitation' }),
    ).toBeVisible();
  });
});
