import { test, expect, type Page } from '@playwright/test';
import { uniqueName } from './helpers';
import { createAccount } from './actions';

function accountRow(page: Page, name: string) {
  return page.getByRole('listitem').filter({ hasText: name });
}

test.describe('CSV import wizard', () => {
  test('imports rows, refreshes balance, and skips duplicates on re-import', async ({
    page,
  }) => {
    const checking = uniqueName('E2E Import');
    const token = `${Date.now()}`;
    const coffee = `Coffee-${token}`;
    const refund = `Refund-${token}`;

    // Account starts at $1,000.
    await createAccount(page, checking, 'checking', '1000.00');

    // A CSV with one expense, one income, and one zero-amount row (a row error).
    const csv =
      'Date,Amount,Payee\n' +
      `2026-06-01,-42.00,${coffee}\n` +
      `2026-06-02,100.00,${refund}\n` +
      '2026-06-03,0,Bad row\n';
    const file = {
      name: 'import.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(csv),
    };

    // Open the wizard, target the account, upload the file.
    await page.goto('/transactions');
    await page.getByRole('button', { name: 'Import CSV' }).click();
    await page.getByLabel('Target account').selectOption({ label: checking });
    await page.getByLabel('CSV file').setInputFiles(file);

    // Mapping step: columns auto-guessed. Move to preview.
    await expect(page.getByLabel('Date column')).toHaveValue('Date');
    await page.getByRole('button', { name: 'Preview' }).click();

    // Preview mirrors the backend: 2 to import, 1 error (the zero row).
    await expect(page.getByText('2 to import')).toBeVisible();
    await expect(page.getByText('Zero amount')).toBeVisible();
    await expect(page.getByText('-$42.00')).toBeVisible();
    await expect(page.getByText('+$100.00')).toBeVisible();

    // Commit.
    await page.getByRole('button', { name: /Import 2 rows/ }).click();
    // exact: true so the result-step span doesn't collide with the toast text
    // ("Imported 2, skipped 0").
    await expect(page.getByText('Imported 2', { exact: true })).toBeVisible();
    await expect(page.getByText('Skipped 0', { exact: true })).toBeVisible();
    await expect(page.getByText('Row 3: Zero amount')).toBeVisible();
    await page.getByRole('button', { name: 'Done' }).click();

    // Ledger shows the imported rows (filter to the account to be robust).
    await page.getByLabel('Filter by account').selectOption({ label: checking });
    await expect(
      page.getByRole('listitem').filter({ hasText: coffee }),
    ).toContainText('-$42.00');
    await expect(
      page.getByRole('listitem').filter({ hasText: refund }),
    ).toContainText('+$100.00');

    // Balance updated by the net delta: 1000 - 42 + 100 = 1058.
    await page.goto('/accounts');
    await expect(accountRow(page, checking)).toContainText('$1,058.00');

    // Re-import the same file → both valid rows are duplicates of stored ones.
    await page.goto('/transactions');
    await page.getByRole('button', { name: 'Import CSV' }).click();
    await page.getByLabel('Target account').selectOption({ label: checking });
    await page.getByLabel('CSV file').setInputFiles(file);
    await page.getByRole('button', { name: 'Preview' }).click();
    await page.getByRole('button', { name: /Import 2 rows/ }).click();

    await expect(page.getByText('Imported 0', { exact: true })).toBeVisible();
    await expect(page.getByText('Skipped 2', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Done' }).click();

    // Balance unchanged after the duplicate re-import.
    await page.goto('/accounts');
    await expect(accountRow(page, checking)).toContainText('$1,058.00');
  });
});
