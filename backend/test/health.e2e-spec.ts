import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { createTestApp, closeTestApp } from './helpers/test-app';

// VEG-373 H2: /health returns 200 with a diagnostic body when the DB is up, and
// 503 when it is disconnected (the disconnected branch is unit-tested, since the
// in-memory Mongo here is always connected). This e2e guards the healthy-path
// wiring — that no global guard/filter rewrites the status or body.
describe('Health (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await closeTestApp(app);
  });

  it('GET /api/health returns 200 with a connected status when the DB is up', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/health')
      .expect(200);

    expect(res.body).toMatchObject({ status: 'ok', database: 'connected' });
    expect(res.body.timestamp).toBeDefined();
  });
});
