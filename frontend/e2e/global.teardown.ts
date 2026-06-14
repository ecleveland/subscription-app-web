import { test as teardown } from '@playwright/test';
import { MongoClient } from 'mongodb';
import { MONGO_URI } from './helpers';

/**
 * Drop the dedicated E2E database once the whole suite has finished, so test
 * runs never leave data behind. Runs as the `setup` project's teardown, after
 * every dependent project completes.
 */
teardown('drop the e2e database', async () => {
  const client = new MongoClient(MONGO_URI);
  try {
    await client.connect();
    await client.db().dropDatabase();
  } finally {
    await client.close();
  }
});
