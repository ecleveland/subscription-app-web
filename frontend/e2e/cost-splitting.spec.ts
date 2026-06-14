import { test, expect } from '@playwright/test';
import { uniqueName } from './helpers';
import { createSubscription, findCard, deleteSubscription } from './actions';

// Covers VEG-61: shared subscription cost splitting.
test.describe('Cost splitting', () => {
  test('shared subscription shows the split badge and personal share', async ({
    page,
  }) => {
    const name = uniqueName('E2E Shared');

    // $20.00 / month split 4 ways → personal share $5.00/mo.
    await createSubscription(page, {
      name,
      cost: '20',
      billingCycle: 'monthly',
      sharedWith: '4',
    });

    const card = await findCard(page, name);
    await expect(card.getByText('Split 4 ways')).toBeVisible();
    await expect(card.getByText('Your share: $5.00/mo')).toBeVisible();

    await deleteSubscription(page, name);
  });
});
