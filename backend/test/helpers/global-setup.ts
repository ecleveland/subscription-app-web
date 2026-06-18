import type { MongoMemoryServer } from 'mongodb-memory-server';
import { startInMemoryMongo } from './mongo-server';

/**
 * Jest globalSetup (VEG-433): start ONE in-memory MongoDB for the whole e2e run.
 *
 * Previously every spec spun up its own `MongoMemoryServer` in `createTestApp`,
 * so a full `--runInBand` run performed ~13 spawn/init/stop cycles back to back.
 * That repeated churn could intermittently wedge a later `MongoMemoryServer.create()`
 * (binary-lock contention / port reuse / fd pressure), hanging the suite. Sharing
 * a single server collapses those cycles to one and removes the churn entirely;
 * `createTestApp` isolates each app on its own uniquely-named database here.
 *
 * The URI is published via `process.env.E2E_MONGO_URI`, which the test process
 * (and any spawned workers) inherit. The instance is stashed on `globalThis` so
 * `global-teardown.ts` can stop it.
 */
export default async function globalSetup(): Promise<void> {
  const mongod = await startInMemoryMongo();
  (globalThis as { __E2E_MONGOD__?: MongoMemoryServer }).__E2E_MONGOD__ =
    mongod;
  process.env.E2E_MONGO_URI = mongod.getUri();
}
