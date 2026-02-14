import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { createTestApp, closeTestApp } from './helpers/test-app';

describe('Subscriptions (e2e)', () => {
  let app: INestApplication<App>;
  let tokenA: string;
  let tokenB: string;

  beforeAll(async () => {
    app = await createTestApp();

    // Create two users
    const resA = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ username: 'usera', password: 'password123' });
    tokenA = resA.body.access_token;

    const resB = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ username: 'userb', password: 'password123' });
    tokenB = resB.body.access_token;
  });

  afterAll(async () => {
    await closeTestApp(app);
  });

  describe('CRUD lifecycle', () => {
    let subId: string;

    it('should create a subscription', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/subscriptions')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          name: 'Netflix',
          cost: 15.99,
          billingCycle: 'monthly',
          nextBillingDate: '2025-07-01',
          category: 'Streaming',
        })
        .expect(201);

      expect(res.body.name).toBe('Netflix');
      expect(res.body.cost).toBe(15.99);
      expect(res.body._id).toBeDefined();
      subId = res.body._id;
    });

    it('should list subscriptions for the user', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/subscriptions')
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);

      expect(res.body).toHaveLength(1);
      expect(res.body[0].name).toBe('Netflix');
    });

    it('should get a single subscription', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/subscriptions/${subId}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);

      expect(res.body.name).toBe('Netflix');
    });

    it('should update a subscription', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/subscriptions/${subId}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ name: 'Netflix Premium', cost: 22.99 })
        .expect(200);

      expect(res.body.name).toBe('Netflix Premium');
      expect(res.body.cost).toBe(22.99);
    });

    it('should toggle isActive', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/subscriptions/${subId}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ isActive: false })
        .expect(200);

      expect(res.body.isActive).toBe(false);
    });

    it('should delete a subscription with 204', async () => {
      await request(app.getHttpServer())
        .delete(`/api/subscriptions/${subId}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(204);

      // Verify deleted
      await request(app.getHttpServer())
        .get(`/api/subscriptions/${subId}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(404);
    });
  });

  describe('Ownership isolation', () => {
    let subIdA: string;

    beforeAll(async () => {
      const res = await request(app.getHttpServer())
        .post('/api/subscriptions')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          name: 'Spotify',
          cost: 9.99,
          billingCycle: 'monthly',
          nextBillingDate: '2025-07-01',
          category: 'Streaming',
        });
      subIdA = res.body._id;
    });

    it('should not allow userB to see userA subscriptions', async () => {
      await request(app.getHttpServer())
        .get(`/api/subscriptions/${subIdA}`)
        .set('Authorization', `Bearer ${tokenB}`)
        .expect(404);
    });

    it('should not allow userB to update userA subscription', async () => {
      await request(app.getHttpServer())
        .patch(`/api/subscriptions/${subIdA}`)
        .set('Authorization', `Bearer ${tokenB}`)
        .send({ name: 'Hacked' })
        .expect(404);
    });

    it('should not allow userB to delete userA subscription', async () => {
      await request(app.getHttpServer())
        .delete(`/api/subscriptions/${subIdA}`)
        .set('Authorization', `Bearer ${tokenB}`)
        .expect(404);
    });

    it('should return empty list for userB', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/subscriptions')
        .set('Authorization', `Bearer ${tokenB}`)
        .expect(200);

      expect(res.body).toHaveLength(0);
    });
  });

  describe('Filtering and sorting', () => {
    beforeAll(async () => {
      // Create multiple subscriptions for userB
      await request(app.getHttpServer())
        .post('/api/subscriptions')
        .set('Authorization', `Bearer ${tokenB}`)
        .send({
          name: 'Netflix',
          cost: 15.99,
          billingCycle: 'monthly',
          nextBillingDate: '2025-07-01',
          category: 'Streaming',
        });
      await request(app.getHttpServer())
        .post('/api/subscriptions')
        .set('Authorization', `Bearer ${tokenB}`)
        .send({
          name: 'AWS',
          cost: 50,
          billingCycle: 'monthly',
          nextBillingDate: '2025-07-15',
          category: 'Software',
        });
      await request(app.getHttpServer())
        .post('/api/subscriptions')
        .set('Authorization', `Bearer ${tokenB}`)
        .send({
          name: 'GitHub Pro',
          cost: 48,
          billingCycle: 'yearly',
          nextBillingDate: '2026-01-01',
          category: 'Software',
        });
    });

    it('should filter by category', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/subscriptions?category=Software')
        .set('Authorization', `Bearer ${tokenB}`)
        .expect(200);

      expect(res.body).toHaveLength(2);
      expect(res.body.every((s: any) => s.category === 'Software')).toBe(true);
    });

    it('should filter by billingCycle', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/subscriptions?billingCycle=yearly')
        .set('Authorization', `Bearer ${tokenB}`)
        .expect(200);

      expect(res.body).toHaveLength(1);
      expect(res.body[0].name).toBe('GitHub Pro');
    });

    it('should sort by cost ascending', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/subscriptions?sortBy=cost&sortOrder=asc')
        .set('Authorization', `Bearer ${tokenB}`)
        .expect(200);

      const costs = res.body.map((s: any) => s.cost);
      expect(costs).toEqual([...costs].sort((a, b) => a - b));
    });
  });

  describe('Billing date advancement', () => {
    it('should advance overdue monthly billing date on GET /subscriptions', async () => {
      const pastDate = new Date();
      pastDate.setMonth(pastDate.getMonth() - 2);

      const createRes = await request(app.getHttpServer())
        .post('/api/subscriptions')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          name: 'Overdue Monthly',
          cost: 9.99,
          billingCycle: 'monthly',
          nextBillingDate: pastDate.toISOString(),
          category: 'Software',
        })
        .expect(201);

      const subId = createRes.body._id;

      const listRes = await request(app.getHttpServer())
        .get('/api/subscriptions')
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);

      const updated = listRes.body.find((s: any) => s._id === subId);
      expect(updated).toBeDefined();
      expect(new Date(updated.nextBillingDate).getTime()).toBeGreaterThan(
        Date.now(),
      );
    });

    it('should not advance billing date for inactive subscriptions', async () => {
      const pastDate = new Date();
      pastDate.setMonth(pastDate.getMonth() - 1);

      const createRes = await request(app.getHttpServer())
        .post('/api/subscriptions')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          name: 'Inactive Service',
          cost: 5.99,
          billingCycle: 'monthly',
          nextBillingDate: pastDate.toISOString(),
          category: 'Software',
          isActive: false,
        })
        .expect(201);

      const subId = createRes.body._id;

      const listRes = await request(app.getHttpServer())
        .get('/api/subscriptions')
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);

      const unchanged = listRes.body.find((s: any) => s._id === subId);
      expect(unchanged).toBeDefined();
      expect(new Date(unchanged.nextBillingDate).getTime()).toBeLessThan(
        Date.now(),
      );
    });

    it('should advance overdue yearly billing date', async () => {
      const pastDate = new Date();
      pastDate.setFullYear(pastDate.getFullYear() - 1);
      pastDate.setMonth(pastDate.getMonth() - 1);

      const createRes = await request(app.getHttpServer())
        .post('/api/subscriptions')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          name: 'Annual License',
          cost: 99.99,
          billingCycle: 'yearly',
          nextBillingDate: pastDate.toISOString(),
          category: 'Software',
        })
        .expect(201);

      const subId = createRes.body._id;

      const listRes = await request(app.getHttpServer())
        .get('/api/subscriptions')
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);

      const updated = listRes.body.find((s: any) => s._id === subId);
      expect(updated).toBeDefined();
      expect(new Date(updated.nextBillingDate).getTime()).toBeGreaterThan(
        Date.now(),
      );
    });
  });

  describe('Validation', () => {
    it('should return 400 when required fields are missing', async () => {
      await request(app.getHttpServer())
        .post('/api/subscriptions')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ name: 'Incomplete' })
        .expect(400);
    });

    it('should return 404 for nonexistent subscription', async () => {
      await request(app.getHttpServer())
        .get('/api/subscriptions/507f1f77bcf86cd799439099')
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(404);
    });
  });
});
