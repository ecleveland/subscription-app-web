import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { createTestApp, closeTestApp } from './helpers/test-app';

describe('Auth rate limiting (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    app = await createTestApp({ disableThrottling: false });
  });

  afterAll(async () => {
    await closeTestApp(app);
  });

  it('should return 429 after 5 login attempts within 60s', async () => {
    for (let i = 0; i < 5; i++) {
      await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ username: 'nobody', password: 'wrong' });
    }

    await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ username: 'nobody', password: 'wrong' })
      .expect(429);
  });

  it('should return 429 after 3 registration attempts within 60s', async () => {
    for (let i = 0; i < 3; i++) {
      await request(app.getHttpServer())
        .post('/api/auth/register')
        .send({ username: `ratelimit${i}`, password: 'password123' });
    }

    await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ username: 'ratelimit3', password: 'password123' })
      .expect(429);
  });
});

describe('Auth (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await closeTestApp(app);
  });

  describe('POST /api/auth/register', () => {
    it('should register a new user and return access_token', () => {
      return request(app.getHttpServer())
        .post('/api/auth/register')
        .send({
          username: 'testuser',
          password: 'password123',
        })
        .expect(201)
        .expect((res) => {
          expect(res.body.access_token).toBeDefined();
          expect(typeof res.body.access_token).toBe('string');
        });
    });

    it('should return 409 on duplicate username', () => {
      return request(app.getHttpServer())
        .post('/api/auth/register')
        .send({
          username: 'testuser',
          password: 'password123',
        })
        .expect(409);
    });

    it('should return 400 when password is missing', () => {
      return request(app.getHttpServer())
        .post('/api/auth/register')
        .send({
          username: 'nopass',
        })
        .expect(400);
    });

    it('should return 400 when password is too short', () => {
      return request(app.getHttpServer())
        .post('/api/auth/register')
        .send({
          username: 'shortpass',
          password: 'short',
        })
        .expect(400);
    });
  });

  describe('POST /api/auth/login', () => {
    it('should return access_token for valid credentials', () => {
      return request(app.getHttpServer())
        .post('/api/auth/login')
        .send({
          username: 'testuser',
          password: 'password123',
        })
        .expect(200)
        .expect((res) => {
          expect(res.body.access_token).toBeDefined();
        });
    });

    it('should return 401 for wrong password', () => {
      return request(app.getHttpServer())
        .post('/api/auth/login')
        .send({
          username: 'testuser',
          password: 'wrongpassword',
        })
        .expect(401);
    });

    it('should return 401 for non-existent user', () => {
      return request(app.getHttpServer())
        .post('/api/auth/login')
        .send({
          username: 'nobody',
          password: 'password123',
        })
        .expect(401);
    });
  });

  describe('Protected routes', () => {
    it('should access protected route with valid token', async () => {
      const loginRes = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ username: 'testuser', password: 'password123' });

      return request(app.getHttpServer())
        .get('/api/users/me')
        .set('Authorization', `Bearer ${loginRes.body.access_token}`)
        .expect(200)
        .expect((res) => {
          expect(res.body.username).toBe('testuser');
        });
    });

    it('should return 401 without a token', () => {
      return request(app.getHttpServer()).get('/api/subscriptions').expect(401);
    });
  });
});
