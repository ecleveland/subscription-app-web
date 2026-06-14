import path from 'path';

// The E2E suite runs against its OWN isolated stack — a dedicated backend and
// frontend on separate ports backed by a throwaway `subscriptions_e2e` database
// — so it never touches the dev `subscriptions` data. Locally these servers are
// started by Playwright's `webServer` config; the database is dropped in
// global.teardown.ts. All values are overridable via env (CI points them at its
// own manually-booted servers).

/** Ports for the dedicated E2E stack (distinct from the dev 3000/3001). */
export const FRONTEND_PORT = process.env.E2E_FRONTEND_PORT || '3100';
export const BACKEND_PORT = process.env.E2E_BACKEND_PORT || '3101';

/** Backend API base URL. */
export const API_URL =
  process.env.E2E_API_URL || `http://localhost:${BACKEND_PORT}/api`;

/** Frontend base URL. */
export const BASE_URL =
  process.env.E2E_BASE_URL || `http://localhost:${FRONTEND_PORT}`;

/**
 * Mongo connection for the dedicated E2E database. Used to promote the seeded
 * admin user (global.setup.ts) and to drop the whole database afterwards
 * (global.teardown.ts). Defaults to a `_e2e` database so it is isolated from
 * dev data even if it somehow points at the same Mongo instance.
 */
export const MONGO_URI =
  process.env.E2E_MONGODB_URI ||
  process.env.MONGODB_URI ||
  'mongodb://localhost:27017/subscriptions_e2e';

/** Saved auth states produced by global.setup.ts. */
export const USER_STATE = path.join(__dirname, '.auth/user.json');
export const ADMIN_STATE = path.join(__dirname, '.auth/admin.json');

/** Stable credentials for the seeded test accounts. */
export const USER = { username: 'e2e-user', password: 'e2e-Password123' };
export const ADMIN = { username: 'e2e-admin', password: 'e2e-Password123' };

/**
 * Unique, human-readable label so repeated runs against a persistent dev
 * database don't collide. Tests locate their own data via the dashboard search
 * box, so this also keeps each test independent of pagination/leftover data.
 */
export function uniqueName(prefix: string): string {
  return `${prefix} ${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

/** A date `days` in the future as a YYYY-MM-DD string for date inputs. */
export function futureDate(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
}
