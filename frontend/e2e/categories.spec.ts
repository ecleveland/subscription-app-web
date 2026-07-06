import { test, expect, type Page } from '@playwright/test';
import { uniqueName } from './helpers';

function groupSection(page: Page, name: string) {
  return page.getByRole('region', { name });
}

function categoryRow(page: Page, group: string, name: string) {
  return groupSection(page, group)
    .getByRole('listitem')
    .filter({ hasText: name });
}

test.describe('Category management', () => {
  test('create group & category, rename, reorder, archive, unarchive', async ({
    page,
  }) => {
    const group = uniqueName('E2E Pets');
    const kibble = uniqueName('E2E Kibble');
    const vet = uniqueName('E2E Vet');
    const treats = uniqueName('E2E Treats');
    const account = uniqueName('E2E Cat Checking');

    await page.goto('/categories');
    await expect(
      page.getByRole('heading', { name: 'Categories' }),
    ).toBeVisible();

    // Create a group.
    await page.getByRole('button', { name: '+ Add group' }).click();
    await page.getByLabel('New group name').fill(group);
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(groupSection(page, group)).toBeVisible();

    // Create two categories in it.
    for (const name of [kibble, vet]) {
      await groupSection(page, group)
        .getByRole('button', { name: '+ Add category' })
        .click();
      await page.getByLabel('Name', { exact: true }).fill(name);
      await page.getByRole('button', { name: 'Create', exact: true }).click();
      await expect(categoryRow(page, group, name)).toBeVisible();
    }

    // Rename the first one.
    await categoryRow(page, group, kibble)
      .getByRole('button', { name: 'Edit' })
      .click();
    await page.getByLabel('Name', { exact: true }).fill(treats);
    await page.getByRole('button', { name: 'Update', exact: true }).click();
    await expect(categoryRow(page, group, treats)).toBeVisible();

    // Reorder: move the second category to the top; survives a reload.
    await page.getByRole('button', { name: `Move ${vet} up` }).click();
    await expect(
      groupSection(page, group).getByRole('listitem').first(),
    ).toContainText(vet);
    await page.reload();
    await expect(
      groupSection(page, group).getByRole('listitem').first(),
    ).toContainText(vet);

    // Archive through the confirm dialog.
    await categoryRow(page, group, treats)
      .getByRole('button', { name: 'Archive' })
      .click();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Archive' })
      .click();
    await expect(categoryRow(page, group, treats)).toHaveCount(0);

    // It now lives in the archived section.
    await page
      .getByRole('button', { name: /Archived categories \(\d+\)/ })
      .click();
    await expect(
      page.getByRole('listitem').filter({ hasText: treats }),
    ).toBeVisible();

    // The transaction form's picker offers the active category but not the
    // archived one.
    await page.goto('/accounts');
    await page.getByRole('button', { name: '+ Add account' }).click();
    await page.getByLabel('Name', { exact: true }).fill(account);
    await page.getByRole('button', { name: 'Create', exact: true }).click();
    // Wait for the row so navigation doesn't abort the in-flight POST.
    await expect(
      page.getByRole('listitem').filter({ hasText: account }),
    ).toBeVisible();
    await page.goto('/transactions');
    await page.getByRole('button', { name: '+ Add transaction' }).click();
    const picker = page.getByLabel('Category', { exact: true });
    await expect(picker.locator('option', { hasText: vet })).toHaveCount(1);
    await expect(picker.locator('option', { hasText: treats })).toHaveCount(0);

    // Unarchive restores it to its group.
    await page.goto('/categories');
    await page
      .getByRole('button', { name: /Archived categories \(\d+\)/ })
      .click();
    await page
      .getByRole('listitem')
      .filter({ hasText: treats })
      .getByRole('button', { name: 'Unarchive' })
      .click();
    await expect(categoryRow(page, group, treats)).toBeVisible();
  });
});
