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

      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].name).toBe('Netflix');
      expect(res.body.meta).toBeDefined();
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

      expect(res.body.data).toHaveLength(0);
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
      await request(app.getHttpServer())
        .post('/api/subscriptions')
        .set('Authorization', `Bearer ${tokenB}`)
        .send({
          name: 'Meal Kit',
          cost: 25,
          billingCycle: 'weekly',
          nextBillingDate: '2025-07-10',
          category: 'Other',
        });
    });

    it('should filter by category', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/subscriptions?category=Software')
        .set('Authorization', `Bearer ${tokenB}`)
        .expect(200);

      expect(res.body.data).toHaveLength(2);
      expect(res.body.data.every((s: any) => s.category === 'Software')).toBe(
        true,
      );
    });

    it('should filter by billingCycle', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/subscriptions?billingCycle=yearly')
        .set('Authorization', `Bearer ${tokenB}`)
        .expect(200);

      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].name).toBe('GitHub Pro');
    });

    it('should filter by weekly billingCycle', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/subscriptions?billingCycle=weekly')
        .set('Authorization', `Bearer ${tokenB}`)
        .expect(200);

      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].name).toBe('Meal Kit');
    });

    it('should sort by normalized monthly cost ascending', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/subscriptions?sortBy=cost&sortOrder=asc')
        .set('Authorization', `Bearer ${tokenB}`)
        .expect(200);

      // Monthly costs: GitHub Pro 48/12=$4, Netflix $15.99, AWS $50, Meal Kit 25*4.33=$108.25
      const names = res.body.data.map((s: any) => s.name);
      expect(names).toEqual(['GitHub Pro', 'Netflix', 'AWS', 'Meal Kit']);
    });
  });

  describe('Pagination', () => {
    // Relies on userB's 4 subscriptions created in "Filtering and sorting" beforeAll
    it('should return paginated envelope with correct meta', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/subscriptions?limit=2&page=1')
        .set('Authorization', `Bearer ${tokenB}`)
        .expect(200);

      expect(res.body.data).toHaveLength(2);
      expect(res.body.meta.total).toBe(4);
      expect(res.body.meta.page).toBe(1);
      expect(res.body.meta.limit).toBe(2);
      expect(res.body.meta.totalPages).toBe(2);
      expect(res.body.meta.hasNextPage).toBe(true);
    });

    it('should return second page results', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/subscriptions?limit=2&page=2')
        .set('Authorization', `Bearer ${tokenB}`)
        .expect(200);

      expect(res.body.data).toHaveLength(2);
      expect(res.body.meta.page).toBe(2);
      expect(res.body.meta.hasNextPage).toBe(false);
    });

    it('should return empty data for page beyond total', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/subscriptions?limit=2&page=10')
        .set('Authorization', `Bearer ${tokenB}`)
        .expect(200);

      expect(res.body.data).toHaveLength(0);
      expect(res.body.meta.total).toBe(4);
    });

    it('should return all results when limit=0', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/subscriptions?limit=0')
        .set('Authorization', `Bearer ${tokenB}`)
        .expect(200);

      expect(res.body.data).toHaveLength(4);
      expect(res.body.meta.totalPages).toBe(1);
      expect(res.body.meta.hasNextPage).toBe(false);
    });

    it('should combine filtering and pagination', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/subscriptions?category=Software&limit=1&page=1')
        .set('Authorization', `Bearer ${tokenB}`)
        .expect(200);

      expect(res.body.data).toHaveLength(1);
      expect(res.body.meta.total).toBe(2);
      expect(res.body.meta.totalPages).toBe(2);
    });

    it('should combine cost sorting and pagination', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/subscriptions?sortBy=cost&sortOrder=asc&limit=2&page=1')
        .set('Authorization', `Bearer ${tokenB}`)
        .expect(200);

      expect(res.body.data).toHaveLength(2);
      // First two by ascending monthly cost: GitHub Pro ($4/mo), Netflix ($15.99/mo)
      const names = res.body.data.map((s: any) => s.name);
      expect(names).toEqual(['GitHub Pro', 'Netflix']);
    });

    it('should return 400 for page=0', async () => {
      await request(app.getHttpServer())
        .get('/api/subscriptions?page=0')
        .set('Authorization', `Bearer ${tokenB}`)
        .expect(400);
    });

    it('should return 400 for limit=101', async () => {
      await request(app.getHttpServer())
        .get('/api/subscriptions?limit=101')
        .set('Authorization', `Bearer ${tokenB}`)
        .expect(400);
    });

    it('should default limit to 20 when not specified', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/subscriptions')
        .set('Authorization', `Bearer ${tokenB}`)
        .expect(200);

      expect(res.body.meta.limit).toBe(20);
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
        .get('/api/subscriptions?limit=0')
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);

      const updated = listRes.body.data.find((s: any) => s._id === subId);
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
        .get('/api/subscriptions?limit=0')
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);

      const unchanged = listRes.body.data.find((s: any) => s._id === subId);
      expect(unchanged).toBeDefined();
      expect(new Date(unchanged.nextBillingDate).getTime()).toBeLessThan(
        Date.now(),
      );
    });

    it('should advance overdue weekly billing date on GET /subscriptions', async () => {
      const pastDate = new Date();
      pastDate.setDate(pastDate.getDate() - 10);

      const createRes = await request(app.getHttpServer())
        .post('/api/subscriptions')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          name: 'Overdue Weekly',
          cost: 25,
          billingCycle: 'weekly',
          nextBillingDate: pastDate.toISOString(),
          category: 'Other',
        })
        .expect(201);

      const subId = createRes.body._id;

      const listRes = await request(app.getHttpServer())
        .get('/api/subscriptions?limit=0')
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);

      const updated = listRes.body.data.find((s: any) => s._id === subId);
      expect(updated).toBeDefined();
      expect(new Date(updated.nextBillingDate).getTime()).toBeGreaterThan(
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
        .get('/api/subscriptions?limit=0')
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);

      const updated = listRes.body.data.find((s: any) => s._id === subId);
      expect(updated).toBeDefined();
      expect(new Date(updated.nextBillingDate).getTime()).toBeGreaterThan(
        Date.now(),
      );
    });
  });

  describe('Bulk operations', () => {
    let bulkSubIds: string[];

    beforeAll(async () => {
      // Create subscriptions for bulk operations using tokenA
      bulkSubIds = [];
      for (const name of ['BulkSub1', 'BulkSub2', 'BulkSub3']) {
        const res = await request(app.getHttpServer())
          .post('/api/subscriptions')
          .set('Authorization', `Bearer ${tokenA}`)
          .send({
            name,
            cost: 10,
            billingCycle: 'monthly',
            nextBillingDate: '2026-07-01',
            category: 'Streaming',
          });
        bulkSubIds.push(res.body._id);
      }
    });

    it('should bulk activate subscriptions', async () => {
      // First deactivate them
      for (const id of bulkSubIds) {
        await request(app.getHttpServer())
          .patch(`/api/subscriptions/${id}`)
          .set('Authorization', `Bearer ${tokenA}`)
          .send({ isActive: false });
      }

      const res = await request(app.getHttpServer())
        .post('/api/subscriptions/bulk')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ ids: bulkSubIds, action: 'activate' })
        .expect(201);

      expect(res.body.success).toBe(3);
      expect(res.body.failed).toBe(0);

      // Verify activated
      for (const id of bulkSubIds) {
        const sub = await request(app.getHttpServer())
          .get(`/api/subscriptions/${id}`)
          .set('Authorization', `Bearer ${tokenA}`)
          .expect(200);
        expect(sub.body.isActive).toBe(true);
      }
    });

    it('should bulk deactivate subscriptions', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/subscriptions/bulk')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ ids: bulkSubIds, action: 'deactivate' })
        .expect(201);

      expect(res.body.success).toBe(3);
      expect(res.body.failed).toBe(0);

      for (const id of bulkSubIds) {
        const sub = await request(app.getHttpServer())
          .get(`/api/subscriptions/${id}`)
          .set('Authorization', `Bearer ${tokenA}`)
          .expect(200);
        expect(sub.body.isActive).toBe(false);
      }
    });

    it('should bulk change category', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/subscriptions/bulk')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ ids: bulkSubIds, action: 'changeCategory', category: 'Gaming' })
        .expect(201);

      expect(res.body.success).toBe(3);
      expect(res.body.failed).toBe(0);

      for (const id of bulkSubIds) {
        const sub = await request(app.getHttpServer())
          .get(`/api/subscriptions/${id}`)
          .set('Authorization', `Bearer ${tokenA}`)
          .expect(200);
        expect(sub.body.category).toBe('Gaming');
      }
    });

    it('should bulk delete subscriptions', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/subscriptions/bulk')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ ids: bulkSubIds, action: 'delete' })
        .expect(201);

      expect(res.body.success).toBe(3);
      expect(res.body.failed).toBe(0);

      // Verify deleted
      for (const id of bulkSubIds) {
        await request(app.getHttpServer())
          .get(`/api/subscriptions/${id}`)
          .set('Authorization', `Bearer ${tokenA}`)
          .expect(404);
      }
    });

    it('should not allow userB to bulk operate on userA subscriptions', async () => {
      // Create a subscription for userA
      const createRes = await request(app.getHttpServer())
        .post('/api/subscriptions')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          name: 'UserA Only',
          cost: 5,
          billingCycle: 'monthly',
          nextBillingDate: '2026-07-01',
          category: 'Other',
        });
      const subIdA = createRes.body._id;

      const res = await request(app.getHttpServer())
        .post('/api/subscriptions/bulk')
        .set('Authorization', `Bearer ${tokenB}`)
        .send({ ids: [subIdA], action: 'delete' })
        .expect(201);

      expect(res.body.success).toBe(0);
      expect(res.body.failed).toBe(1);

      // Verify still exists for userA
      await request(app.getHttpServer())
        .get(`/api/subscriptions/${subIdA}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);
    });

    it('should return 400 for empty ids array', async () => {
      await request(app.getHttpServer())
        .post('/api/subscriptions/bulk')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ ids: [], action: 'delete' })
        .expect(400);
    });

    it('should return 400 for changeCategory without category', async () => {
      await request(app.getHttpServer())
        .post('/api/subscriptions/bulk')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ ids: ['507f1f77bcf86cd799439011'], action: 'changeCategory' })
        .expect(400);
    });

    it('should return 401 when unauthorized', async () => {
      await request(app.getHttpServer())
        .post('/api/subscriptions/bulk')
        .send({ ids: ['507f1f77bcf86cd799439011'], action: 'delete' })
        .expect(401);
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
