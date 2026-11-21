import { test, expect } from '@playwright/test';
import { uniqueName } from './helpers';
import { addExpense, createAccount } from './actions';

test.describe('Business page', () => {
  test('mark a labeled expense reimbursed and watch the outstanding total drop', async ({
    page,
  }) => {
    const label = uniqueName('E2E Biz Page');
    const account = uniqueName('E2E Biz Page Checking');
    const payee = uniqueName('E2E Kiln');
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

    // One personal expense and one reimbursable business expense.
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
      reimbursable: true,
    });

    // The nav item exists once the household has a label. Exact, because the
    // dashboard tile has an "Open Business" link too.
    await expect(
      page
        .getByRole('navigation')
        .getByRole('link', { name: 'Business', exact: true }),
    ).toBeVisible();

    // Scope everything to this test's label so other specs sharing the E2E
    // database cannot change the numbers.
    await page.goto('/business');
    await page.getByLabel('Business label').selectOption({ label });

    const thisMonth = page.getByRole('region', { name: 'This month' });
    await expect(
      thisMonth.getByRole('group', { name: 'Spend', exact: true }),
    ).toContainText('$55.00');

    // getByText resolves to the innermost element whose text matches: the
    // "Outstanding: $55.00 across 1 expense" line.
    const outstanding = page
      .getByRole('region', { name: 'Reimbursements' })
      .getByText(/^Outstanding:/);
    await expect(outstanding).toContainText('Outstanding: $55.00');

    const owed = page.getByRole('list', { name: 'Owed reimbursements' });
    await owed
      .getByRole('listitem')
      .filter({ hasText: payee })
      .getByRole('button', { name: 'Mark reimbursed' })
      .click();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Mark reimbursed' })
      .click();

    await expect(outstanding).toContainText('Outstanding: $0.00');
    await expect(owed.getByText(payee)).toHaveCount(0);
    await expect(
      page.getByRole('list', { name: 'Reimbursed expenses' }),
    ).toContainText(payee);
  });
});
