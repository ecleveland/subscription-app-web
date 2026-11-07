import { test, expect, type Page } from '@playwright/test';
import { uniqueName } from './helpers';
import { addExpense, createAccount } from './actions';

/** Transactions-list rows for a payee. Visibility checks take .first()
 *  because a CI retry can re-add the same payee into the not-yet-dropped
 *  E2E database. */
function txRow(page: Page, payee: string) {
  return page.getByRole('listitem').filter({ hasText: payee });
}

test.describe('Business labels', () => {
  test('create a label, add a labeled expense, filter the list', async ({
    page,
  }) => {
    const label = uniqueName('E2E Biz');
    const account = uniqueName('E2E Biz Checking');
    const payee = uniqueName('E2E Adobe');
    const personalPayee = uniqueName('E2E Bakery');

    // Create the label on the categories page.
    await page.goto('/categories');
    await page.getByRole('button', { name: '+ Add label' }).click();
    await page.getByLabel('Name', { exact: true }).fill(label);
    await page.getByRole('button', { name: 'Create', exact: true }).click();
    await expect(
      page
        .getByRole('region', { name: 'Labels' })
        .getByRole('listitem')
        .filter({ hasText: label }),
    ).toBeVisible();

    // One personal expense and one business expense.
    await createAccount(page, account, 'checking');
    await addExpense(page, {
      account,
      category: 'Groceries',
      amount: '12.00',
      payee: personalPayee,
    });
    await addExpense(page, {
      account,
      category: 'Groceries',
      amount: '55.00',
      payee,
      label,
    });

    // Only the business row carries the chip.
    await expect(txRow(page, payee).first()).toContainText(label);
    await expect(txRow(page, personalPayee).first()).not.toContainText(label);

    // Filtering by the label keeps the business row only.
    const filter = page.getByLabel('Filter by label');
    await filter.selectOption({ label });
    await expect(txRow(page, payee).first()).toBeVisible();
    await expect(txRow(page, personalPayee)).toHaveCount(0);

    // Filtering by Personal keeps the personal row only. 'none' is the
    // option value for Personal.
    await filter.selectOption('none');
    await expect(txRow(page, personalPayee).first()).toBeVisible();
    await expect(txRow(page, payee)).toHaveCount(0);
  });
});
