import { test, expect } from '@playwright/test';
import { uniqueName, futureDate } from './helpers';
import { createSubscription, findCard, deleteSubscription } from './actions';

// Covers VEG-59: trial tracking.
test.describe('Trial tracking', () => {
  test('trial subscription shows a badge and counts in the dashboard summary', async ({
    page,
  }) => {
    const name = uniqueName('E2E Trial');

    await createSubscription(page, {
      name,
      cost: '12.00',
      trialEndDate: futureDate(10),
    });

    const card = await findCard(page, name);
    await expect(card.getByText('Trial', { exact: true })).toBeVisible();
    await expect(card.getByText(/Trial ends in \d+ days?/)).toBeVisible();

    // The dashboard summary renders a "Trials" tile only when an active trial
    // exists; it is driven by all subscriptions, not the search filter. Its
    // presence is the dashboard-level "trial count" signal.
    await expect(page.getByText('Trials', { exact: true })).toBeVisible();

    await deleteSubscription(page, name);
  });
});
