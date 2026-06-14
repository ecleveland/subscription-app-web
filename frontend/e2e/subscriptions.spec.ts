import { test, expect } from '@playwright/test';
import { uniqueName } from './helpers';
import { createSubscription, findCard } from './actions';

test.describe('Subscription CRUD', () => {
  test('create, view on dashboard, edit, then delete', async ({ page }) => {
    const name = uniqueName('E2E CRUD');

    // Create
    await createSubscription(page, { name, cost: '9.99' });

    // View on dashboard
    let card = await findCard(page, name);
    await expect(card).toContainText('$9.99');

    // Edit — change the cost
    await card.click();
    await expect(page).toHaveURL(/\/subscriptions\/.+\/edit$/);
    await page.getByLabel('Cost ($)').fill('19.99');
    await page.getByRole('button', { name: 'Update' }).click();
    await expect(page).toHaveURL(/\/$/);

    card = await findCard(page, name);
    await expect(card).toContainText('$19.99');

    // Delete — confirmed via the native window.confirm dialog
    await card.click();
    await expect(page).toHaveURL(/\/subscriptions\/.+\/edit$/);
    page.once('dialog', (dialog) => dialog.accept());
    await page.getByRole('button', { name: 'Delete' }).click();
    await expect(page).toHaveURL(/\/$/);

    // Gone from the dashboard
    await page.goto('/');
    await page.getByLabel('Search subscriptions').fill(name);
    await expect(page.getByRole('link').filter({ hasText: name })).toHaveCount(0);
  });
});
