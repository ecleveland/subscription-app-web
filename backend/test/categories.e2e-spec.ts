import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { createTestApp, closeTestApp } from './helpers/test-app';

describe('Categories (e2e)', () => {
  let app: INestApplication<App>;
  let token: string;

  beforeAll(async () => {
    app = await createTestApp();
    const res = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ username: 'catuser', password: 'Password123' });
    token = res.body.access_token;
  });

  afterAll(async () => {
    await closeTestApp(app);
  });

  it('lists the seeded categories for the household', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/categories')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);
    expect(res.body[0]).toMatchObject({
      name: expect.any(String),
      isIncome: expect.any(Boolean),
    });
    // Income categories are present (the seed includes a Paycheck etc.).
    expect(res.body.some((c: { isIncome: boolean }) => c.isIncome)).toBe(true);
  });

  it('lists the seeded category groups', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/categories/groups')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);
    expect(res.body[0]).toMatchObject({ name: expect.any(String) });
  });

  it('requires authentication', async () => {
    await request(app.getHttpServer()).get('/api/categories').expect(401);
  });
});
