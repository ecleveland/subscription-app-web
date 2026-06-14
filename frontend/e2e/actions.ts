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
