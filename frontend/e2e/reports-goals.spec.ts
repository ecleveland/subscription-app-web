import { test, expect } from '@playwright/test';
import { uniqueName } from './helpers';

test.describe('Reports and goals', () => {
  test('analytics redirects to reports and the four sections render', async ({
    page,
  }) => {
    await page.goto('/analytics');
    await expect(page).toHaveURL(/\/reports$/);

    await expect(
      page.getByRole('heading', { level: 1, name: 'Reports' }),
    ).toBeVisible();
    for (const name of [
      'Cash flow',
      'Spending by category',
      'Net worth',
      'Subscriptions',
    ]) {
      await expect(
        page.getByRole('heading', { level: 2, name }),
      ).toBeVisible();
    }
    // Headings render even when a fetch fails, so also require that no
    // section shows an error. Wait for loading to finish first, or the
    // check could pass before any error has rendered.
    await expect(page.getByText(/^Loading /)).toHaveCount(0);
    await expect(page.getByText(/failed/i)).toHaveCount(0);
  });

  test('create a goal, contribute, then archive and unarchive', async ({
    page,
  }) => {
    const name = uniqueName('E2E Goal');

    await page.goto('/goals');
    await page.getByRole('button', { name: '+ Add goal' }).click();
    await page.getByLabel('Name', { exact: true }).fill(name);
    await page.getByLabel('Type', { exact: true }).selectOption('savings');
    await page.getByLabel('Target ($)').fill('100');
    await page.getByRole('button', { name: 'Create', exact: true }).click();

    // Scoped to this spec's unique name so parallel specs' goals don't
    // interfere.
    const card = page.getByRole('listitem').filter({ hasText: name });
    await expect(card).toBeVisible();
    await expect(card.getByText('0%', { exact: true })).toBeVisible();

    await card.getByLabel('Contribution ($)').fill('25');
    await card.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(card.getByText('25%', { exact: true })).toBeVisible();

    await card.getByRole('button', { name: 'Archive', exact: true }).click();
    await expect(card).toHaveCount(0);

    await page.getByLabel('Show archived').check();
    await expect(card).toBeVisible();
    await expect(
      card.getByRole('button', { name: 'Unarchive', exact: true }),
    ).toBeVisible();
  });
});
