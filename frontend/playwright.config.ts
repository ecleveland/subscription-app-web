import { defineConfig, devices } from '@playwright/test';
import {
  USER_STATE,
  ADMIN_STATE,
  API_URL,
  BASE_URL,
  MONGO_URI,
  FRONTEND_PORT,
  BACKEND_PORT,
} from './e2e/helpers';

/**
 * Playwright E2E configuration.
 *
 * The suite runs against its OWN isolated stack so it never pollutes dev data:
 * a dedicated backend (:3101) and frontend (:3100) backed by a throwaway
 * `subscriptions_e2e` database. Locally, Playwright starts both servers (see
 * `webServer` below) and global.teardown.ts drops the database when the run
 * finishes. In CI the servers are booted by the workflow, so `webServer` is
 * disabled there (CI sets E2E_BASE_URL / E2E_API_URL to its own ports).
 *
 * Auth is handled once in `e2e/global.setup.ts`, which seeds a regular user and
 * an admin user and saves their `storageState` so the rest of the suite starts
 * already logged in.
 */
const useWebServer = !process.env.CI && !process.env.E2E_NO_WEBSERVER;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  // Mutations target one shared database; serialize in CI for determinism.
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [['html', { open: 'never' }], ['list']] : 'list',

  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
  },

  projects: [
    {
      name: 'setup',
      testMatch: /global\.setup\.ts/,
      // Drop the E2E database after every dependent project finishes.
      teardown: 'cleanup',
    },
    {
      name: 'cleanup',
      testMatch: /global\.teardown\.ts/,
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

  // Locally, boot a dedicated backend + frontend against the isolated E2E
  // database. Requires MongoDB to be running (e.g. `docker compose up -d mongo`).
  webServer: useWebServer
    ? [
        {
          command: 'npm run start',
          cwd: '../backend',
          url: `${API_URL}/health`,
          timeout: 120_000,
          reuseExistingServer: false,
          stdout: 'pipe',
          stderr: 'pipe',
          env: {
            PORT: BACKEND_PORT,
            MONGODB_URI: MONGO_URI,
            JWT_SECRET: 'e2e-jwt-secret-at-least-32-chars-long',
            JWT_EXPIRES_IN: '24h',
            FRONTEND_URL: BASE_URL,
            // Disable auth rate limiting so reruns don't trip the throttler.
            THROTTLE_DISABLED: 'true',
          },
        },
        {
          command: 'npm run dev',
          url: `${BASE_URL}/login`,
          timeout: 120_000,
          reuseExistingServer: false,
          stdout: 'pipe',
          stderr: 'pipe',
          env: {
            PORT: FRONTEND_PORT,
            NEXT_PUBLIC_API_URL: API_URL,
          },
        },
      ]
    : undefined,
});
