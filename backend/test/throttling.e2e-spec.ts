import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { createTestApp, closeTestApp } from './helpers/test-app';

// VEG-373 M4: the ThrottlerGuard is registered globally (APP_GUARD), so routes
// without an explicit @UseGuards/@Throttle are still rate limited. Health is a
// public, unauthenticated route — a good probe for the global default limit.
describe('Global rate limiting (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    app = await createTestApp({ disableThrottling: false });
  });

  afterAll(async () => {
    await closeTestApp(app);
  });

  it('throttles a non-auth route via the global guard (default 60/min)', async () => {
    // The default throttler allows 60 requests per 60s window.
    for (let i = 0; i < 60; i++) {
      await request(app.getHttpServer()).get('/api/health').expect(200);
    }

    // The 61st request within the window is blocked.
    await request(app.getHttpServer()).get('/api/health').expect(429);
  });

  it('tracks the limit per client IP via X-Forwarded-For (trust proxy)', async () => {
    // Exhaust the window for one client IP.
    for (let i = 0; i < 60; i++) {
      await request(app.getHttpServer())
        .get('/api/health')
        .set('X-Forwarded-For', '203.0.113.1')
        .expect(200);
    }
    await request(app.getHttpServer())
      .get('/api/health')
      .set('X-Forwarded-For', '203.0.113.1')
      .expect(429);

    // A different client IP has its own bucket and is unaffected — proving the
    // limiter keys on the forwarded client IP, not a single shared proxy IP.
    await request(app.getHttpServer())
      .get('/api/health')
      .set('X-Forwarded-For', '203.0.113.2')
      .expect(200);
  });
});
