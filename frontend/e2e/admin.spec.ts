import { test, expect } from '@playwright/test';
import { USER, ADMIN } from './helpers';

// Runs under the `chromium-admin` project (admin storageState).
test.describe('Admin user management', () => {
  test('admin can list users', async ({ page }) => {
    await page.goto('/admin/users');
    await expect(
      page.getByRole('heading', { name: 'User Management' }),
    ).toBeVisible();

    // Both seeded accounts appear in the table (scoped to <td> cells to avoid
    // matching the hidden mobile card view).
    await expect(
      page.getByRole('cell', { name: ADMIN.username, exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('cell', { name: USER.username, exact: true }),
    ).toBeVisible();
  });

  test('admin can create a new user', async ({ page }) => {
    const newUsername = `e2e-created-${Date.now()}`;

    await page.goto('/admin/users');
    await page.getByRole('link', { name: '+ New User' }).click();
    await expect(page).toHaveURL(/\/admin\/users\/new$/);

    await page.getByLabel('Username').fill(newUsername);
    await page.getByLabel('Password').fill('e2e-Password123');
    await page.getByRole('button', { name: 'Create User' }).click();

    await expect(page).toHaveURL(/\/admin\/users$/);
    await expect(
      page.getByRole('cell', { name: newUsername, exact: true }),
    ).toBeVisible();
  });
});
