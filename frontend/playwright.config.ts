import { defineConfig, devices } from '@playwright/test';
import { USER_STATE, ADMIN_STATE } from './e2e/helpers';

/**
 * Playwright E2E configuration.
 *
 * The suite runs against an already-running dev environment (MongoDB + backend
 * on :3001 + frontend on :3000). Locally: run `./dev.sh` from the repo root,
 * then `npm run test:e2e`. In CI the `e2e.yml` workflow boots all three first.
 *
 * Auth is handled once in `e2e/global.setup.ts`, which seeds a regular user and
 * an admin user and saves their `storageState` (auth-flag cookie + localStorage
 * token) so the rest of the suite starts already logged in.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  // Mutations target a shared dev database; serialize in CI for determinism.
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [['html', { open: 'never' }], ['list']] : 'list',

  use: {
    baseURL: process.env.E2E_BASE_URL || 'http://localhost:3000',
    trace: 'on-first-retry',
  },

  projects: [
    {
      name: 'setup',
      testMatch: /global\.setup\.ts/,
    },
    {
      // Authenticated regular-user tests (the default for most specs).
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], storageState: USER_STATE },
      dependencies: ['setup'],
      testMatch: /.*\.spec\.ts$/,
      testIgnore: /admin\.spec\.ts$/,
    },
    {
      // Admin-only tests run with the admin storageState.
      name: 'chromium-admin',
      use: { ...devices['Desktop Chrome'], storageState: ADMIN_STATE },
      dependencies: ['setup'],
      testMatch: /admin\.spec\.ts$/,
    },
  ],
});
