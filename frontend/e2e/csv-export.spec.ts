import { test, expect } from '@playwright/test';
import fs from 'fs';
import { uniqueName, futureDate } from './helpers';
import { createSubscription, deleteSubscription } from './actions';

test.describe('CSV export', () => {
  test('exports a CSV with the expected headers', async ({ page }) => {
    const name = uniqueName('E2E Export');

    // Ensure there is exportable data covering the trial + shared columns.
    await createSubscription(page, {
      name,
      cost: '15',
      trialEndDate: futureDate(14),
      sharedWith: '3',
    });

    await page.goto('/');
    const exportButton = page.getByRole('button', { name: 'Export CSV' });
    await expect(exportButton).toBeEnabled();

    const downloadPromise = page.waitForEvent('download');
    await exportButton.click();
    const download = await downloadPromise;

    expect(download.suggestedFilename()).toBe('subscriptions.csv');

    const filePath = await download.path();
    const content = fs.readFileSync(filePath, 'utf-8');
    const header = content.split('\n')[0];

    // The export must include the trial and cost-splitting columns.
    expect(header).toContain('Trial End Date');
    expect(header).toContain('Shared With');

    await deleteSubscription(page, name);
  });
});
