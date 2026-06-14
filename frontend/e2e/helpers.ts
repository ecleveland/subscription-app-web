import path from 'path';

/** Backend API base URL (matches the frontend default). */
export const API_URL =
  process.env.E2E_API_URL || 'http://localhost:3001/api';

/** Frontend base URL. */
export const BASE_URL = process.env.E2E_BASE_URL || 'http://localhost:3000';

/** Mongo connection used only to promote the seeded admin user. */
export const MONGO_URI =
  process.env.E2E_MONGODB_URI ||
  process.env.MONGODB_URI ||
  'mongodb://localhost:27017/subscriptions';

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
