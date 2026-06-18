import type { MongoMemoryServer } from 'mongodb-memory-server';

/**
 * Jest globalTeardown (VEG-433): stop the shared in-memory MongoDB started in
 * `global-setup.ts`. Runs once after the entire e2e run.
 */
export default async function globalTeardown(): Promise<void> {
  const mongod = (globalThis as { __E2E_MONGOD__?: MongoMemoryServer })
    .__E2E_MONGOD__;
  if (mongod) {
    await mongod.stop();
  }
}
