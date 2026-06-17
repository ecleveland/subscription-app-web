import { test, expect, Page, Browser, APIRequestContext } from '@playwright/test';
import { API_URL } from './helpers';

// This flow needs two distinct, freshly-registered users (each with an email,
// since invitation acceptance is email-matched), so it manages its own logins
// rather than reusing the shared seeded storageState.
test.use({ storageState: { cookies: [], origins: [] } });

const PASSWORD = 'e2e-Password123';

function uniqueUser(prefix: string): { username: string; email: string } {
  const id = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const username = `e2e-${prefix}-${id}`;
  return { username, email: `${username}@example.com` };
}

/** Register a user (with email) via the public API. */
async function registerUser(
  request: APIRequestContext,
  username: string,
  email: string,
): Promise<void> {
  const res = await request.post(`${API_URL}/auth/register`, {
    data: { username, password: PASSWORD, email },
  });
  expect(res.ok(), `register ${username}: ${res.status()}`).toBeTruthy();
}

/** Log in through the UI; resolves once the authenticated header has rendered. */
async function loginViaUI(page: Page, username: string): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign In' }).click();
  await expect(page.getByRole('button', { name: 'Logout' })).toBeVisible();
}

async function newUserPage(browser: Browser, username: string): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await loginViaUI(page, username);
  return page;
}

test.describe('Household invite → accept → shared view', () => {
  test('an invited user joins and sees the shared household', async ({
    browser,
    request,
  }) => {
    const owner = uniqueUser('owner');
    const invitee = uniqueUser('invitee');
    await registerUser(request, owner.username, owner.email);
    await registerUser(request, invitee.username, invitee.email);

    const householdName = `Shared HH ${Date.now()}`;

    // --- Owner: rename the household and invite the second user. ---
    const ownerPage = await newUserPage(browser, owner.username);
    await ownerPage.goto('/household');

    // Wait for the form to prefill from the loaded household before typing, so
    // the field-init effect can't clobber the new value.
    const nameInput = ownerPage.getByLabel('Name');
    await expect(nameInput).not.toHaveValue('');
    await nameInput.fill(householdName);
    await ownerPage.getByRole('button', { name: 'Save Changes' }).click();
    await expect(
      ownerPage.getByText('Household updated successfully.'),
    ).toBeVisible();

    await ownerPage.getByLabel('Email').fill(invitee.email);
    await ownerPage.getByRole('button', { name: 'Send Invitation' }).click();

    const inviteLink = ownerPage.getByLabel('Invite link');
    await expect(inviteLink).toBeVisible();
    const inviteUrl = await inviteLink.inputValue();
    const token = new URL(inviteUrl).searchParams.get('token');
    expect(token).toBeTruthy();

    // --- Invitee: accept via the invite link, land on the shared household. ---
    const inviteePage = await newUserPage(browser, invitee.username);
    await inviteePage.goto(`/household/accept?token=${token}`);
    await inviteePage
      .getByRole('button', { name: 'Accept Invitation' })
      .click();

    await expect(inviteePage).toHaveURL(/\/household$/);

    // The invitee now sees the owner's renamed household and both members.
    await expect(
      inviteePage.getByRole('heading', { name: 'Household', exact: true }),
    ).toBeVisible();
    await expect(inviteePage.getByText(householdName).first()).toBeVisible();
    // exact: usernames are substrings of their emails, also shown in the row.
    await expect(
      inviteePage.getByText(owner.username, { exact: true }),
    ).toBeVisible();
    await expect(
      inviteePage.getByText(invitee.username, { exact: true }),
    ).toBeVisible();

    // The shared household name also surfaces in the header.
    await expect(
      inviteePage.getByRole('link', { name: householdName }),
    ).toBeVisible();

    await ownerPage.context().close();
    await inviteePage.context().close();
  });

  test('the accept page rejects an invalid token', async ({
    browser,
    request,
  }) => {
    const user = uniqueUser('badtoken');
    await registerUser(request, user.username, user.email);

    const page = await newUserPage(browser, user.username);
    await page.goto('/household/accept?token=not-a-real-token');
    await page.getByRole('button', { name: 'Accept Invitation' }).click();

    // The message appears inline and as a toast; assert at least one is shown.
    await expect(
      page.getByText('Invalid or expired invitation').first(),
    ).toBeVisible();
    await page.context().close();
  });
});
