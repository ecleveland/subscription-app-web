import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp, closeTestApp } from './helpers/test-app';

describe('Swagger / OpenAPI (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await closeTestApp(app);
  });

  it('GET /api/docs-json — returns valid OpenAPI 3.x document', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/docs-json')
      .expect(200);

    expect(res.body.openapi).toMatch(/^3\./);
    expect(res.body.info).toBeDefined();
    expect(res.body.info.title).toBe('Subscription App API');
    expect(res.body.paths).toBeDefined();
  });

  it('includes all expected API paths', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/docs-json')
      .expect(200);

    const paths = Object.keys(res.body.paths);

    const expectedPaths = [
      '/api/auth/login',
      '/api/auth/register',
      '/api/users/me',
      '/api/users/me/change-password',
      '/api/subscriptions',
      '/api/subscriptions/{id}',
      '/api/admin/users',
      '/api/admin/users/{id}',
    ];

    for (const expectedPath of expectedPaths) {
      expect(paths).toContain(expectedPath);
    }
  });

  it('defines Bearer auth security scheme', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/docs-json')
      .expect(200);

    const securitySchemes = res.body.components?.securitySchemes;
    expect(securitySchemes).toBeDefined();
    expect(securitySchemes.bearer).toBeDefined();
    expect(securitySchemes.bearer.type).toBe('http');
    expect(securitySchemes.bearer.scheme).toBe('bearer');
  });

  it('GET /api/docs — serves Swagger UI HTML', async () => {
    const res = await request(app.getHttpServer()).get('/api/docs').expect(200);

    expect(res.text).toContain('swagger-ui');
  });
});
