import { test, expect, type Page } from '@playwright/test';
import { uniqueName } from './helpers';
import { createAccount } from './actions';

/** The accounts-list row for a given account name. */
function accountRow(page: Page, name: string) {
  return page.getByRole('listitem').filter({ hasText: name });
}

test.describe('Accounts & transaction ledger', () => {
  test('create accounts, record an expense and a transfer, balances update', async ({
    page,
  }) => {
    const checking = uniqueName('E2E Checking');
    const savings = uniqueName('E2E Savings');

    // Two accounts: checking starts at $1,000, savings at $0.
    await createAccount(page, checking, 'checking', '1000.00');
    await createAccount(page, savings, 'savings');
    await expect(accountRow(page, checking)).toContainText('$1,000.00');

    // Record a $42 expense against checking.
    await page.goto('/transactions');
    await page.getByRole('button', { name: '+ Add transaction' }).click();
    await page.getByLabel('Type', { exact: true }).selectOption('expense');
    await page.getByLabel('Account', { exact: true }).selectOption({ label: checking });
    await page.getByLabel('Category', { exact: true }).selectOption({ label: 'Groceries' });
    await page.getByLabel('Amount ($)').fill('42.00');
    await page.getByLabel('Payee').fill('Whole Foods');
    await page.getByRole('button', { name: 'Add', exact: true }).click();

    await expect(
      page.getByRole('listitem').filter({ hasText: 'Whole Foods' }),
    ).toContainText('-$42.00');

    // Checking dropped by $42.
    await page.goto('/accounts');
    await expect(accountRow(page, checking)).toContainText('$958.00');

    // Transfer $100 from checking to savings.
    await page.goto('/transactions');
    await page.getByRole('button', { name: '+ Add transaction' }).click();
    await page.getByLabel('Type', { exact: true }).selectOption('transfer');
    await page.getByLabel('From account').selectOption({ label: checking });
    await page.getByLabel('To account').selectOption({ label: savings });
    await page.getByLabel('Amount ($)').fill('100.00');
    await page.getByRole('button', { name: 'Add', exact: true }).click();

    await expect(
      page.getByRole('listitem').filter({ hasText: 'Transfer' }).first(),
    ).toBeVisible();

    // Both balances reflect the transfer.
    await page.goto('/accounts');
    await expect(accountRow(page, checking)).toContainText('$858.00');
    await expect(accountRow(page, savings)).toContainText('$100.00');
  });
});
