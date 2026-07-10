import { test, expect, type Page } from '@playwright/test';
import { uniqueName } from './helpers';
import { addExpense, createAccount } from './actions';

function groupSection(page: Page, name: string) {
  return page.getByRole('region', { name });
}

// All assertions stay scoped to this spec's unique row: the budget is
// household-wide and parallel specs add their own spend, so summary totals
// (and any shared category's numbers) are non-deterministic here.
function budgetRow(page: Page, group: string, name: string) {
  return groupSection(page, group)
    .getByRole('listitem')
    .filter({ hasText: name });
}

test.describe('Budget page', () => {
  test('set a limit, record spend, see actual/remaining and over-budget update', async ({
    page,
  }) => {
    const group = uniqueName('E2E Fun');
    const category = uniqueName('E2E Streaming');
    const account = uniqueName('E2E Budget Checking');

    // Unique group + category so parallel specs sharing the e2e household
    // can't perturb this row.
    await page.goto('/categories');
    await page.getByRole('button', { name: '+ Add group' }).click();
    await page.getByLabel('New group name').fill(group);
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(groupSection(page, group)).toBeVisible();

    await groupSection(page, group)
      .getByRole('button', { name: '+ Add category' })
      .click();
    await page.getByLabel('Name', { exact: true }).fill(category);
    await page.getByRole('button', { name: 'Create', exact: true }).click();
    await expect(budgetRow(page, group, category)).toBeVisible();

    await createAccount(page, account, 'checking', '1000.00');

    // The category starts as a zeroed row in the current month's budget.
    await page.goto('/budget');
    const row = budgetRow(page, group, category);
    await expect(row).toBeVisible();

    // Set a $500 monthly limit inline.
    await row.getByRole('button', { name: `Edit limit for ${category}` }).click();
    await page.getByLabel(`Monthly limit for ${category}`).fill('500.00');
    await row.getByRole('button', { name: 'Save' }).click();
    await expect(row).toContainText('$500.00');

    // Record a matching $120 expense (form date defaults to today, so it
    // lands in the currently selected month).
    await addExpense(page, {
      account,
      category,
      amount: '120.00',
      payee: uniqueName('E2E Popcorn Palace'),
    });

    // Actual and remaining update.
    await page.goto('/budget');
    await expect(row).toContainText('$500.00');
    await expect(row).toContainText('$120.00');
    await expect(row).toContainText('$380.00');
    await expect(row).not.toContainText('Over budget');

    // Lower the limit below the spend → over-budget state.
    await row.getByRole('button', { name: `Edit limit for ${category}` }).click();
    await page.getByLabel(`Monthly limit for ${category}`).fill('100.00');
    await row.getByRole('button', { name: 'Save' }).click();
    await expect(row).toContainText('Over budget');
    await expect(row).toContainText('-$20.00');

    // The previous month is untouched: the row exists but is zeroed. Wait for
    // the row to re-render first — the group sections unmount while the new
    // month loads, and negative assertions against an absent row pass
    // vacuously.
    await page.getByRole('button', { name: 'Previous month' }).click();
    await expect(row).toBeVisible();
    // A leaked limit would render planned $100.00 here.
    await expect(row).not.toContainText('$100.00');
    await expect(row).not.toContainText('Over budget');
    await expect(row).toContainText('$0.00');
  });
});
