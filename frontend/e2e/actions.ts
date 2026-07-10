import { Page, Locator, expect } from '@playwright/test';
import { futureDate } from './helpers';

export interface NewSub {
  name: string;
  cost: string;
  billingCycle?: 'weekly' | 'monthly' | 'yearly';
  nextBillingDate?: string;
  /** When set, enables "Has free trial" and fills the trial end date. */
  trialEndDate?: string;
  /** When set, enables "Shared subscription" and fills the people count. */
  sharedWith?: string;
}

/** Create a subscription through the form and wait for the dashboard redirect. */
export async function createSubscription(page: Page, sub: NewSub): Promise<void> {
  await page.goto('/subscriptions/new');
  await page.getByLabel('Name', { exact: true }).fill(sub.name);
  await page.getByLabel('Cost ($)').fill(sub.cost);
  if (sub.billingCycle) {
    await page.getByLabel('Billing Cycle').selectOption(sub.billingCycle);
  }
  await page
    .getByLabel('Next Billing Date')
    .fill(sub.nextBillingDate ?? futureDate(30));
  if (sub.trialEndDate) {
    await page.getByLabel('Has free trial').check();
    await page.getByLabel('Trial End Date').fill(sub.trialEndDate);
  }
  if (sub.sharedWith) {
    await page.getByLabel('Shared subscription').check();
    await page
      .getByLabel('Number of people sharing (including you)')
      .fill(sub.sharedWith);
  }
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
}

/** Create an account through the /accounts form and wait for its row. */
export async function createAccount(
  page: Page,
  name: string,
  type: string,
  opening?: string,
): Promise<void> {
  await page.goto('/accounts');
  await page.getByRole('button', { name: '+ Add account' }).click();
  await page.getByLabel('Name', { exact: true }).fill(name);
  await page.getByLabel('Type', { exact: true }).selectOption(type);
  if (opening) {
    await page.getByLabel('Opening balance ($)').fill(opening);
  }
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  // Waiting for the row also keeps a following navigation from aborting the
  // in-flight POST.
  await expect(
    page.getByRole('listitem').filter({ hasText: name }),
  ).toBeVisible();
}

/** Record an expense through the /transactions form and wait for its row
 *  (which also keeps a following navigation from aborting the POST). The
 *  form's date defaults to today, so the expense lands in the current month. */
export async function addExpense(
  page: Page,
  tx: { account: string; category: string; amount: string; payee: string },
): Promise<void> {
  await page.goto('/transactions');
  await page.getByRole('button', { name: '+ Add transaction' }).click();
  await page.getByLabel('Type', { exact: true }).selectOption('expense');
  await page
    .getByLabel('Account', { exact: true })
    .selectOption({ label: tx.account });
  await page
    .getByLabel('Category', { exact: true })
    .selectOption({ label: tx.category });
  await page.getByLabel('Amount ($)').fill(tx.amount);
  await page.getByLabel('Payee').fill(tx.payee);
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  // .first(): payees aren't necessarily unique (a CI retry re-adds the same
  // payee into the not-yet-dropped e2e DB), and a strict-mode violation here
  // would turn a transient flake into a deterministic failure.
  await expect(
    page.getByRole('listitem').filter({ hasText: tx.payee }).first(),
  ).toBeVisible();
}

/**
 * Go to the dashboard, search for a subscription by name (search filters across
 * all subscriptions client-side, so this is robust to pagination), and return
 * the matching card locator.
 */
export async function findCard(page: Page, name: string): Promise<Locator> {
  await page.goto('/');
  await page.getByLabel('Search subscriptions').fill(name);
  const card = page.getByRole('link').filter({ hasText: name });
  await expect(card).toBeVisible();
  return card;
}

/** Delete a subscription via its edit page (keeps the shared dev DB tidy). */
export async function deleteSubscription(page: Page, name: string): Promise<void> {
  const card = await findCard(page, name);
  await card.click();
  await expect(page).toHaveURL(/\/subscriptions\/.+\/edit$/);
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Delete' }).click();
  await expect(page).toHaveURL(/\/$/);
}
