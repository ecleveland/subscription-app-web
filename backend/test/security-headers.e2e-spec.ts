import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { createTestApp, closeTestApp } from './helpers/test-app';

describe('Security headers (e2e)', () => {
  let app: INestApplication<App>;
  let authToken: string;

  beforeAll(async () => {
    app = await createTestApp();

    // Register a user to test authenticated endpoints
    const res = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ username: 'headeruser', password: 'Test1234!' });
    authToken = res.body.access_token;
  });

  afterAll(async () => {
    await closeTestApp(app);
  });

  it('should set X-Content-Type-Options to nosniff', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/auth/login')
      .expect(404);

    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  it('should set X-Frame-Options to SAMEORIGIN', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/subscriptions')
      .set('Authorization', `Bearer ${authToken}`);

    expect(res.headers['x-frame-options']).toBe('SAMEORIGIN');
  });

  it('should set Strict-Transport-Security with max-age', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/subscriptions')
      .set('Authorization', `Bearer ${authToken}`);

    expect(res.headers['strict-transport-security']).toMatch(/max-age=/);
  });

  it('should remove X-Powered-By header', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/subscriptions')
      .set('Authorization', `Bearer ${authToken}`);

    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('should not set Content-Security-Policy (disabled for JSON API)', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/subscriptions')
      .set('Authorization', `Bearer ${authToken}`);

    expect(res.headers['content-security-policy']).toBeUndefined();
  });

  it('should include security headers on authenticated endpoints', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/subscriptions')
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);

    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('SAMEORIGIN');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('should include security headers on 404 responses', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/nonexistent-route')
      .expect(404);

    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('SAMEORIGIN');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });
});
