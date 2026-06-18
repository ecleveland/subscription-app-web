import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp, closeTestApp } from './helpers/test-app';

/**
 * Guards the VEG-433 shared-in-memory-MongoDB refactor: a single server is
 * started once (global-setup.ts) and every `createTestApp()` call gets its own
 * fresh database on it. This asserts that data created in one app is NOT visible
 * to a second app — i.e. per-app isolation is preserved despite the shared server.
 */
describe('Shared in-memory MongoDB isolation (e2e)', () => {
  const creds = { username: 'isolation_probe', password: 'Sup3rSecret!pw' };

  it('gives each app a fresh, isolated database', async () => {
    const appA: INestApplication = await createTestApp();
    try {
      await request(appA.getHttpServer())
        .post('/api/auth/register')
        .send(creds)
        .expect(201);

      // Same app, same DB: the user exists, so login succeeds.
      await request(appA.getHttpServer())
        .post('/api/auth/login')
        .send(creds)
        .expect(200);
    } finally {
      await closeTestApp(appA);
    }

    const appB: INestApplication = await createTestApp();
    try {
      // Different app => different database => the user from appA does not exist.
      await request(appB.getHttpServer())
        .post('/api/auth/login')
        .send(creds)
        .expect(401);
    } finally {
      await closeTestApp(appB);
    }
  });
});
