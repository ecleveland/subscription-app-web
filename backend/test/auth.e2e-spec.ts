import { INestApplication } from '@nestjs/common';
import { Connection } from 'mongoose';
import { getConnectionToken } from '@nestjs/mongoose';
import * as crypto from 'crypto';
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
    it('should register a new user and return access_token and refresh_token', () => {
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
          expect(res.body.refresh_token).toBeDefined();
          expect(typeof res.body.refresh_token).toBe('string');
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
    it('should return access_token and refresh_token for valid credentials', () => {
      return request(app.getHttpServer())
        .post('/api/auth/login')
        .send({
          username: 'testuser',
          password: 'password123',
        })
        .expect(200)
        .expect((res) => {
          expect(res.body.access_token).toBeDefined();
          expect(res.body.refresh_token).toBeDefined();
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

  describe('POST /api/auth/refresh', () => {
    it('should return new token pair for valid refresh token', async () => {
      const loginRes = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ username: 'testuser', password: 'password123' });

      const refreshToken = loginRes.body.refresh_token;

      await request(app.getHttpServer())
        .post('/api/auth/refresh')
        .send({ refresh_token: refreshToken })
        .expect(200)
        .expect((res) => {
          expect(res.body.access_token).toBeDefined();
          expect(res.body.refresh_token).toBeDefined();
          // New refresh token should be different from old one (rotation)
          expect(res.body.refresh_token).not.toBe(refreshToken);
        });
    });

    it('should reject old refresh token after rotation', async () => {
      const loginRes = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ username: 'testuser', password: 'password123' });

      const oldRefreshToken = loginRes.body.refresh_token;

      // Use the refresh token once
      await request(app.getHttpServer())
        .post('/api/auth/refresh')
        .send({ refresh_token: oldRefreshToken })
        .expect(200);

      // Try to use the same refresh token again
      await request(app.getHttpServer())
        .post('/api/auth/refresh')
        .send({ refresh_token: oldRefreshToken })
        .expect(401);
    });

    it('should return 401 for invalid refresh token', () => {
      return request(app.getHttpServer())
        .post('/api/auth/refresh')
        .send({ refresh_token: 'invalid-token' })
        .expect(401);
    });
  });

  describe('POST /api/auth/logout', () => {
    it('should revoke refresh token so it cannot be used afterwards', async () => {
      const loginRes = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ username: 'testuser', password: 'password123' });

      const { access_token, refresh_token } = loginRes.body;

      // Logout
      await request(app.getHttpServer())
        .post('/api/auth/logout')
        .set('Authorization', `Bearer ${access_token}`)
        .send({ refresh_token })
        .expect(204);

      // Try to use the revoked refresh token
      await request(app.getHttpServer())
        .post('/api/auth/refresh')
        .send({ refresh_token })
        .expect(401);
    });

    it('should return 401 without a JWT', () => {
      return request(app.getHttpServer())
        .post('/api/auth/logout')
        .send({ refresh_token: 'some-token' })
        .expect(401);
    });
  });

  describe('Password change revokes refresh tokens', () => {
    it('should invalidate refresh tokens after password change', async () => {
      // Register a fresh user
      const regRes = await request(app.getHttpServer())
        .post('/api/auth/register')
        .send({ username: 'pwchangeuser', password: 'password123' });

      const { access_token, refresh_token } = regRes.body;

      // Change password
      await request(app.getHttpServer())
        .post('/api/users/me/change-password')
        .set('Authorization', `Bearer ${access_token}`)
        .send({ currentPassword: 'password123', newPassword: 'newpass123' })
        .expect(204);

      // Old refresh token should be rejected
      await request(app.getHttpServer())
        .post('/api/auth/refresh')
        .send({ refresh_token })
        .expect(401);
    });
  });

  describe('POST /api/auth/forgot-password', () => {
    it('should return 200 for a valid email', () => {
      return request(app.getHttpServer())
        .post('/api/auth/forgot-password')
        .send({ email: 'test@example.com' })
        .expect(200)
        .expect((res) => {
          expect(res.body.message).toContain('reset link');
        });
    });

    it('should return 200 for a non-existent email (enumeration prevention)', () => {
      return request(app.getHttpServer())
        .post('/api/auth/forgot-password')
        .send({ email: 'nonexistent@example.com' })
        .expect(200)
        .expect((res) => {
          expect(res.body.message).toContain('reset link');
        });
    });

    it('should return 400 for invalid email format', () => {
      return request(app.getHttpServer())
        .post('/api/auth/forgot-password')
        .send({ email: 'not-an-email' })
        .expect(400);
    });
  });

  describe('POST /api/auth/reset-password', () => {
    it('should return 400 for an invalid token', () => {
      return request(app.getHttpServer())
        .post('/api/auth/reset-password')
        .send({ token: 'invalid-token', password: 'newpassword123' })
        .expect(400);
    });

    it('should return 400 when password is too short', () => {
      return request(app.getHttpServer())
        .post('/api/auth/reset-password')
        .send({ token: 'some-token', password: 'short' })
        .expect(400);
    });
  });

  describe('Password reset full flow', () => {
    it('should allow resetting password and logging in with new password', async () => {
      // Register a user with an email
      await request(app.getHttpServer()).post('/api/auth/register').send({
        username: 'resetuser',
        password: 'oldpassword123',
        email: 'resetuser@example.com',
      });

      // Request forgot-password
      await request(app.getHttpServer())
        .post('/api/auth/forgot-password')
        .send({ email: 'resetuser@example.com' })
        .expect(200);

      // Extract token from DB
      const connection = app.get<Connection>(getConnectionToken());
      const resetDoc = await connection
        .collection('passwordresets')
        .findOne({ email: 'resetuser@example.com' });
      expect(resetDoc).toBeDefined();

      // We need the plain token, not the hash. Since we can't recover it,
      // we'll generate one and insert it manually for the test.
      const plainToken = crypto.randomBytes(32).toString('hex');
      const tokenHash = crypto
        .createHash('sha256')
        .update(plainToken)
        .digest('hex');

      await connection.collection('passwordresets').insertOne({
        email: 'resetuser@example.com',
        tokenHash,
        expiresAt: new Date(Date.now() + 3600000),
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      // Reset password with the token
      await request(app.getHttpServer())
        .post('/api/auth/reset-password')
        .send({ token: plainToken, password: 'newpassword123' })
        .expect(200);

      // Login with new password should succeed
      await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ username: 'resetuser', password: 'newpassword123' })
        .expect(200)
        .expect((res) => {
          expect(res.body.access_token).toBeDefined();
          expect(res.body.refresh_token).toBeDefined();
        });

      // Login with old password should fail
      await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ username: 'resetuser', password: 'oldpassword123' })
        .expect(401);

      // Reusing the same token should fail
      await request(app.getHttpServer())
        .post('/api/auth/reset-password')
        .send({ token: plainToken, password: 'anotherpassword' })
        .expect(400);
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
