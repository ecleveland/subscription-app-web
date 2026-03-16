import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { createTestApp, closeTestApp } from './helpers/test-app';
import { NotificationsCronService } from '../src/notifications/notifications-cron.service';

describe('Notifications (e2e)', () => {
  let app: INestApplication<App>;
  let tokenA: string;
  let tokenB: string;
  let cronService: NotificationsCronService;

  beforeAll(async () => {
    app = await createTestApp();
    cronService = app.get(NotificationsCronService);

    const resA = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ username: 'notif_usera', password: 'password123' });
    tokenA = resA.body.access_token;

    const resB = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ username: 'notif_userb', password: 'password123' });
    tokenB = resB.body.access_token;
  });

  afterAll(async () => {
    await closeTestApp(app);
  });

  describe('Cron job and notification lifecycle', () => {
    it('should create a subscription with reminderDaysBefore', async () => {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);

      const res = await request(app.getHttpServer())
        .post('/api/subscriptions')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          name: 'Netflix',
          cost: 15.99,
          billingCycle: 'monthly',
          nextBillingDate: tomorrow.toISOString(),
          category: 'Streaming',
          reminderDaysBefore: 3,
        })
        .expect(201);

      expect(res.body.reminderDaysBefore).toBe(3);
    });

    it('should create notifications when cron runs', async () => {
      await cronService.handleRenewalReminders();

      const res = await request(app.getHttpServer())
        .get('/api/notifications')
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);

      expect(res.body.data.length).toBeGreaterThanOrEqual(1);
      expect(res.body.data[0].title).toContain('Netflix');
      expect(res.body.unreadCount).toBeGreaterThanOrEqual(1);
    });

    it('should return unread count', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/notifications/unread-count')
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);

      expect(res.body.count).toBeGreaterThanOrEqual(1);
    });

    it('should mark a notification as read', async () => {
      const listRes = await request(app.getHttpServer())
        .get('/api/notifications')
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);

      const notifId = listRes.body.data[0]._id;

      const res = await request(app.getHttpServer())
        .patch(`/api/notifications/${notifId}/read`)
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);

      expect(res.body.read).toBe(true);
    });

    it('should mark all as read', async () => {
      // Trigger cron again to potentially create more (won't duplicate)
      // Create another subscription for a second notification
      const future = new Date();
      future.setDate(future.getDate() + 2);

      await request(app.getHttpServer())
        .post('/api/subscriptions')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          name: 'Spotify',
          cost: 9.99,
          billingCycle: 'monthly',
          nextBillingDate: future.toISOString(),
          category: 'Streaming',
          reminderDaysBefore: 5,
        });

      await cronService.handleRenewalReminders();

      await request(app.getHttpServer())
        .post('/api/notifications/mark-all-read')
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(204);

      const res = await request(app.getHttpServer())
        .get('/api/notifications/unread-count')
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);

      expect(res.body.count).toBe(0);
    });

    it('should delete a notification', async () => {
      const listRes = await request(app.getHttpServer())
        .get('/api/notifications')
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);

      const notifId = listRes.body.data[0]._id;

      await request(app.getHttpServer())
        .delete(`/api/notifications/${notifId}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(204);

      // Verify deleted
      await request(app.getHttpServer())
        .patch(`/api/notifications/${notifId}/read`)
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(404);
    });
  });

  describe('User isolation', () => {
    it('should not allow userB to see userA notifications', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/notifications')
        .set('Authorization', `Bearer ${tokenB}`)
        .expect(200);

      expect(res.body.data).toHaveLength(0);
      expect(res.body.unreadCount).toBe(0);
    });

    it('should return 404 when userB tries to mark userA notification as read', async () => {
      const listRes = await request(app.getHttpServer())
        .get('/api/notifications')
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);

      if (listRes.body.data.length > 0) {
        const notifId = listRes.body.data[0]._id;

        await request(app.getHttpServer())
          .patch(`/api/notifications/${notifId}/read`)
          .set('Authorization', `Bearer ${tokenB}`)
          .expect(404);
      }
    });
  });

  describe('Auth required', () => {
    it('should return 401 without token', async () => {
      await request(app.getHttpServer()).get('/api/notifications').expect(401);
    });
  });

  describe('Duplicate prevention', () => {
    it('should not create duplicate notifications on repeated cron runs', async () => {
      // Run cron first to ensure all pending notifications are created
      await cronService.handleRenewalReminders();

      const before = await request(app.getHttpServer())
        .get('/api/notifications')
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);

      // Run cron again — should not create duplicates
      await cronService.handleRenewalReminders();

      const after = await request(app.getHttpServer())
        .get('/api/notifications')
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);

      expect(after.body.data.length).toBe(before.body.data.length);
    });
  });
});
