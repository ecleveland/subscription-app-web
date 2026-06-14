import { test as setup, expect, APIRequestContext, Browser } from '@playwright/test';
import { MongoClient } from 'mongodb';
import fs from 'fs';
import path from 'path';
import {
  API_URL,
  BASE_URL,
  MONGO_URI,
  USER,
  ADMIN,
  USER_STATE,
  ADMIN_STATE,
} from './helpers';

type Creds = { username: string; password: string };

/** Poll the backend health endpoint and the frontend until both respond. */
async function waitForServers(request: APIRequestContext): Promise<void> {
  const deadline = Date.now() + 60_000;
  const targets = [`${API_URL}/health`, BASE_URL];
  for (const url of targets) {
    let lastErr: unknown;
    while (Date.now() < deadline) {
      try {
        const res = await request.get(url, { timeout: 5_000 });
        if (res.ok()) {
          lastErr = undefined;
          break;
        }
        lastErr = new Error(`${url} responded ${res.status()}`);
      } catch (err) {
        lastErr = err;
      }
      await new Promise((r) => setTimeout(r, 1_000));
    }
    if (lastErr) {
      throw new Error(
        `E2E servers not reachable. Start the dev environment (./dev.sh) before ` +
          `running the suite. Last error for ${url}: ${String(lastErr)}`,
      );
    }
  }
}

/**
 * Register a user via the public API; tolerate the account already existing.
 * We deliberately avoid an extra verification login here — the UI login in
 * loginAndSaveState() doubles as the credential check, keeping the number of
 * rate-limited auth requests low for local runs.
 */
async function ensureUser(
  request: APIRequestContext,
  creds: Creds,
): Promise<void> {
  const res = await request.post(`${API_URL}/auth/register`, { data: creds });
  // 201 = created, 409 = already exists. Anything else is unexpected.
  expect(
    res.ok() || res.status() === 409,
    `Unexpected response registering "${creds.username}": ${res.status()}`,
  ).toBeTruthy();
}

/** Promote the seeded admin account to the admin role directly in Mongo. */
async function promoteToAdmin(username: string): Promise<void> {
  const client = new MongoClient(MONGO_URI);
  try {
    await client.connect();
    const res = await client
      .db()
      .collection('users')
      .updateOne({ username }, { $set: { role: 'admin' } });
    expect(
      res.matchedCount,
      `Admin user "${username}" not found in Mongo`,
    ).toBe(1);
  } finally {
    await client.close();
  }
}

/** Log in through the UI and persist the resulting storageState. */
async function loginAndSaveState(
  browser: Browser,
  creds: Creds,
  statePath: string,
): Promise<void> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`${BASE_URL}/login`);
  await page.getByLabel('Username').fill(creds.username);
  await page.getByLabel('Password').fill(creds.password);
  await page.getByRole('button', { name: 'Sign In' }).click();
  // The header only renders Logout once authenticated state has hydrated.
  await expect(page.getByRole('button', { name: 'Logout' })).toBeVisible();
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  await context.storageState({ path: statePath });
  await context.close();
}

setup('seed users and save auth states', async ({ browser, request }) => {
  await waitForServers(request);

  await ensureUser(request, USER);
  await ensureUser(request, ADMIN);
  await promoteToAdmin(ADMIN.username);

  await loginAndSaveState(browser, USER, USER_STATE);
  await loginAndSaveState(browser, ADMIN, ADMIN_STATE);
});
