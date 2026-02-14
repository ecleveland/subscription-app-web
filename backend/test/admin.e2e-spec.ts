import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { createTestApp, closeTestApp } from './helpers/test-app';
import { UsersService } from '../src/users/users.service';
import { SubscriptionsService } from '../src/subscriptions/subscriptions.service';

describe('Admin (e2e)', () => {
  let app: INestApplication<App>;
  let adminToken: string;
  let userToken: string;
  let adminId: string;
  let regularUserId: string;

  beforeAll(async () => {
    app = await createTestApp();

    // Register the first user (will become admin)
    const adminRegRes = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ username: 'admin', password: 'password123' });
    adminToken = adminRegRes.body.access_token;

    // Get admin's profile to get their ID
    const adminProfile = await request(app.getHttpServer())
      .get('/api/users/me')
      .set('Authorization', `Bearer ${adminToken}`);
    adminId = adminProfile.body._id;

    // Promote to admin via the UsersService directly
    const usersService = app.get(UsersService);
    await usersService.update(adminId, { role: 'admin' } as any);

    // Re-login to get a token with the admin role in the JWT
    const adminLoginRes = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ username: 'admin', password: 'password123' });
    adminToken = adminLoginRes.body.access_token;

    // Register a regular user
    const userRegRes = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ username: 'regularuser', password: 'password123' });
    userToken = userRegRes.body.access_token;

    const userProfile = await request(app.getHttpServer())
      .get('/api/users/me')
      .set('Authorization', `Bearer ${userToken}`);
    regularUserId = userProfile.body._id;
  });

  afterAll(async () => {
    await closeTestApp(app);
  });

  describe('Access control', () => {
    it('should deny non-admin access to admin routes', async () => {
      await request(app.getHttpServer())
        .get('/api/admin/users')
        .set('Authorization', `Bearer ${userToken}`)
        .expect(403);
    });

    it('should deny unauthenticated access to admin routes', async () => {
      await request(app.getHttpServer())
        .get('/api/admin/users')
        .expect(401);
    });
  });

  describe('Admin user management', () => {
    it('should list all users', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/admin/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThanOrEqual(2);
    });

    it('should get a specific user', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/admin/users/${regularUserId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body.username).toBe('regularuser');
      expect(res.body.passwordHash).toBeUndefined();
    });

    it('should create a new user', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/admin/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          username: 'newuser',
          password: 'password123',
        })
        .expect(201);

      expect(res.body.username).toBe('newuser');
    });

    it('should update a user role', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/admin/users/${regularUserId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ role: 'admin' })
        .expect(200);

      expect(res.body.role).toBe('admin');
    });
  });

  describe('Admin safeguards', () => {
    it('should prevent self-deletion', async () => {
      await request(app.getHttpServer())
        .delete(`/api/admin/users/${adminId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(403);
    });

    it('should prevent demoting the last admin', async () => {
      // Demote regularUser back to user so admin is the only admin
      await request(app.getHttpServer())
        .patch(`/api/admin/users/${regularUserId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ role: 'user' });

      // Now try to demote the only admin
      await request(app.getHttpServer())
        .patch(`/api/admin/users/${adminId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ role: 'user' })
        .expect(403);
    });

    it('should allow deleting a non-admin user with 204', async () => {
      // Create a throwaway user
      const createRes = await request(app.getHttpServer())
        .post('/api/admin/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ username: 'todelete', password: 'password123' });

      await request(app.getHttpServer())
        .delete(`/api/admin/users/${createRes.body._id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(204);
    });
  });

  describe('Cascade deletion', () => {
    it('should delete user subscriptions when deleting a user', async () => {
      // Create a user to delete
      const createRes = await request(app.getHttpServer())
        .post('/api/admin/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ username: 'cascadeuser', password: 'password123' });
      const targetUserId = createRes.body._id;

      // Log in as the target user and create a subscription
      const loginRes = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ username: 'cascadeuser', password: 'password123' });
      const targetToken = loginRes.body.access_token;

      await request(app.getHttpServer())
        .post('/api/subscriptions')
        .set('Authorization', `Bearer ${targetToken}`)
        .send({
          name: 'Netflix',
          cost: 15.99,
          billingCycle: 'monthly',
          nextBillingDate: '2026-06-01',
          category: 'Streaming',
        })
        .expect(201);

      // Verify subscription exists
      const subsBefore = await request(app.getHttpServer())
        .get('/api/subscriptions')
        .set('Authorization', `Bearer ${targetToken}`)
        .expect(200);
      expect(subsBefore.body.length).toBe(1);

      // Admin deletes the user
      await request(app.getHttpServer())
        .delete(`/api/admin/users/${targetUserId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(204);

      // Verify subscriptions are gone
      const subsService = app.get(SubscriptionsService);
      const remaining = await subsService.findAll(targetUserId, {});
      expect(remaining).toHaveLength(0);
    });
  });
});
