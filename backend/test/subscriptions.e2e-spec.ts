import { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { createTestApp, closeTestApp } from './helpers/test-app';
import { SubscriptionsService } from '../src/subscriptions/subscriptions.service';
import { SubscriptionsCronService } from '../src/subscriptions/subscriptions-cron.service';
import { HouseholdsService } from '../src/households/households.service';
import {
  HouseholdMember,
  HouseholdMemberDocument,
  HouseholdRole,
  MembershipStatus,
} from '../src/households/schemas/household-member.schema';

/** Decode the `sub` (userId) claim from a JWT access token. */
function userIdFromToken(token: string): string {
  const payload = JSON.parse(
    Buffer.from(token.split('.')[1], 'base64').toString('utf8'),
  ) as { sub: string };
  return payload.sub;
}

describe('Subscriptions (e2e)', () => {
  let app: INestApplication<App>;
  let tokenA: string;
  let tokenB: string;

  beforeAll(async () => {
    app = await createTestApp();

    // Each registered user is provisioned their own personal household, so
    // usera and userb start in separate households (the basis for the
    // cross-household isolation assertions below).
    const resA = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ username: 'usera', password: 'Password123' });
    tokenA = resA.body.access_token;

    const resB = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ username: 'userb', password: 'Password123' });
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
    // Advancement now runs from the scheduled cron, never the read path. These
    // tests invoke the service/cron directly (the GET endpoint no longer writes).
    let subsService: SubscriptionsService;

    const createSub = async (
      body: Record<string, unknown>,
    ): Promise<string> => {
      const res = await request(app.getHttpServer())
        .post('/api/subscriptions')
        .set('Authorization', `Bearer ${tokenA}`)
        .send(body)
        .expect(201);
      return res.body._id;
    };

    const getSub = async (subId: string): Promise<any> => {
      const res = await request(app.getHttpServer())
        .get('/api/subscriptions?limit=0')
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);
      return res.body.data.find((s: any) => s._id === subId);
    };

    beforeAll(() => {
      subsService = app.get(SubscriptionsService);
    });

    it('does not advance overdue dates from the read path (GET /subscriptions)', async () => {
      const pastDate = new Date();
      pastDate.setMonth(pastDate.getMonth() - 2);
      const subId = await createSub({
        name: 'Read Path Overdue',
        cost: 9.99,
        billingCycle: 'monthly',
        nextBillingDate: pastDate.toISOString(),
        category: 'Software',
      });

      const before = await getSub(subId);
      expect(new Date(before.nextBillingDate).getTime()).toBeLessThan(
        Date.now(),
      );
    });

    it('advances an overdue monthly billing date when advancement runs', async () => {
      const pastDate = new Date();
      pastDate.setMonth(pastDate.getMonth() - 2);
      const subId = await createSub({
        name: 'Overdue Monthly',
        cost: 9.99,
        billingCycle: 'monthly',
        nextBillingDate: pastDate.toISOString(),
        category: 'Software',
      });

      await subsService.advanceOverdueDates();

      const updated = await getSub(subId);
      expect(updated).toBeDefined();
      expect(new Date(updated.nextBillingDate).getTime()).toBeGreaterThan(
        Date.now(),
      );
    });

    it('does not advance billing date for inactive subscriptions', async () => {
      const pastDate = new Date();
      pastDate.setMonth(pastDate.getMonth() - 1);
      const subId = await createSub({
        name: 'Inactive Service',
        cost: 5.99,
        billingCycle: 'monthly',
        nextBillingDate: pastDate.toISOString(),
        category: 'Software',
        isActive: false,
      });

      await subsService.advanceOverdueDates();

      const unchanged = await getSub(subId);
      expect(unchanged).toBeDefined();
      expect(new Date(unchanged.nextBillingDate).getTime()).toBeLessThan(
        Date.now(),
      );
    });

    it('advances an overdue weekly billing date', async () => {
      const pastDate = new Date();
      pastDate.setDate(pastDate.getDate() - 10);
      const subId = await createSub({
        name: 'Overdue Weekly',
        cost: 25,
        billingCycle: 'weekly',
        nextBillingDate: pastDate.toISOString(),
        category: 'Other',
      });

      await subsService.advanceOverdueDates();

      const updated = await getSub(subId);
      expect(updated).toBeDefined();
      expect(new Date(updated.nextBillingDate).getTime()).toBeGreaterThan(
        Date.now(),
      );
    });

    it('advances an overdue yearly billing date', async () => {
      const pastDate = new Date();
      pastDate.setFullYear(pastDate.getFullYear() - 1);
      pastDate.setMonth(pastDate.getMonth() - 1);
      const subId = await createSub({
        name: 'Annual License',
        cost: 99.99,
        billingCycle: 'yearly',
        nextBillingDate: pastDate.toISOString(),
        category: 'Software',
      });

      await subsService.advanceOverdueDates();

      const updated = await getSub(subId);
      expect(updated).toBeDefined();
      expect(new Date(updated.nextBillingDate).getTime()).toBeGreaterThan(
        Date.now(),
      );
    });

    it('runs via the scheduled cron under a daily leader lock', async () => {
      const cron = app.get(SubscriptionsCronService);
      const pastDate = new Date();
      pastDate.setMonth(pastDate.getMonth() - 3);
      const subId = await createSub({
        name: 'Cron Overdue',
        cost: 12.5,
        billingCycle: 'monthly',
        nextBillingDate: pastDate.toISOString(),
        category: 'Software',
      });

      // First run wins the lock and advances the overdue subscription.
      await cron.handleOverdueAdvancement();
      const updated = await getSub(subId);
      expect(new Date(updated.nextBillingDate).getTime()).toBeGreaterThan(
        Date.now(),
      );

      // Second run the same day finds the lock held and is a no-op (no throw).
      await expect(cron.handleOverdueAdvancement()).resolves.toBeUndefined();
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

  describe('CSV Export', () => {
    it('should return CSV with correct Content-Type and Content-Disposition', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/subscriptions/export')
        .set('Authorization', `Bearer ${tokenB}`)
        .expect(200);

      expect(res.headers['content-type']).toContain('text/csv');
      expect(res.headers['content-disposition']).toBe(
        'attachment; filename="subscriptions.csv"',
      );
      const lines = res.text.split('\n');
      expect(lines[0]).toBe(
        'Name,Cost,Billing Cycle,Category,Next Billing Date,Status,Notes,Tags,Trial End Date,Shared With',
      );
      // userB has 4 subscriptions from "Filtering and sorting" beforeAll
      expect(lines.length).toBeGreaterThanOrEqual(5);
    });

    it('should return 401 without auth', async () => {
      await request(app.getHttpServer())
        .get('/api/subscriptions/export')
        .expect(401);
    });

    it('should respect category filter', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/subscriptions/export?category=Software')
        .set('Authorization', `Bearer ${tokenB}`)
        .expect(200);

      const lines = res.text.split('\n');
      // header + 2 Software subscriptions (AWS, GitHub Pro)
      expect(lines).toHaveLength(3);
    });
  });

  describe('Tags', () => {
    let tagSubId: string;

    it('should create a subscription with tags', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/subscriptions')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          name: 'Tagged Sub',
          cost: 10,
          billingCycle: 'monthly',
          nextBillingDate: '2026-07-01',
          category: 'Software',
          tags: ['shared', 'essential'],
        })
        .expect(201);

      expect(res.body.tags).toEqual(['shared', 'essential']);
      tagSubId = res.body._id;
    });

    it('should update tags on a subscription', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/subscriptions/${tagSubId}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ tags: ['updated'] })
        .expect(200);

      expect(res.body.tags).toEqual(['updated']);
    });

    it('should filter subscriptions by tags', async () => {
      // Create another subscription with a different tag
      await request(app.getHttpServer())
        .post('/api/subscriptions')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          name: 'Other Tagged Sub',
          cost: 20,
          billingCycle: 'monthly',
          nextBillingDate: '2026-07-01',
          category: 'Software',
          tags: ['unique-tag'],
        });

      const res = await request(app.getHttpServer())
        .get('/api/subscriptions?tags=unique-tag')
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);

      expect(res.body.data.length).toBeGreaterThanOrEqual(1);
      expect(
        res.body.data.every((s: any) => s.tags.includes('unique-tag')),
      ).toBe(true);
    });

    it('should include tags in CSV export', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/subscriptions/export')
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);

      const lines = res.text.split('\n');
      expect(lines[0]).toContain('Tags');
    });
  });

  describe('Shared subscriptions', () => {
    let sharedSubId: string;

    it('should create a subscription with sharedWith', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/subscriptions')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          name: 'Family Plan',
          cost: 30,
          billingCycle: 'monthly',
          nextBillingDate: '2026-07-01',
          category: 'Streaming',
          sharedWith: 3,
        })
        .expect(201);

      expect(res.body.sharedWith).toBe(3);
      sharedSubId = res.body._id;
    });

    it('should update sharedWith to null to clear it', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/subscriptions/${sharedSubId}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ sharedWith: null })
        .expect(200);

      expect(res.body.sharedWith).toBeNull();
    });

    it('should reject sharedWith of 1 (minimum is 2)', async () => {
      await request(app.getHttpServer())
        .post('/api/subscriptions')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          name: 'Bad Share',
          cost: 10,
          billingCycle: 'monthly',
          nextBillingDate: '2026-07-01',
          category: 'Other',
          sharedWith: 1,
        })
        .expect(400);
    });

    it('should filter shared subscriptions with ?shared=shared', async () => {
      // Re-set sharedWith on the sub
      await request(app.getHttpServer())
        .patch(`/api/subscriptions/${sharedSubId}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ sharedWith: 3 });

      const res = await request(app.getHttpServer())
        .get('/api/subscriptions?shared=shared&limit=0')
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);

      expect(res.body.data.length).toBeGreaterThanOrEqual(1);
      expect(res.body.data.every((s: any) => s.sharedWith >= 2)).toBe(true);
    });

    it('should filter individual subscriptions with ?shared=individual', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/subscriptions?shared=individual&limit=0')
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);

      expect(
        res.body.data.every(
          (s: any) => s.sharedWith == null || s.sharedWith < 2,
        ),
      ).toBe(true);
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

  // The keystone of VEG-389: data is scoped to the household, not the user. A
  // co-member of the household sees and edits shared subscriptions; a member of
  // a different household is fully isolated.
  describe('Household scoping (shared + cross-household isolation)', () => {
    let householdsService: HouseholdsService;
    let memberModel: Model<HouseholdMemberDocument>;
    let tokenC: string; // a user we move into usera's household
    let householdAId: string;
    let sharedSubId: string;

    beforeAll(async () => {
      householdsService = app.get(HouseholdsService);
      memberModel = app.get<Model<HouseholdMemberDocument>>(
        getModelToken(HouseholdMember.name),
      );

      // Register a fresh user (gets their own personal household first).
      const resC = await request(app.getHttpServer())
        .post('/api/auth/register')
        .send({ username: 'userc', password: 'Password123' });
      tokenC = resC.body.access_token;
      const userCId = userIdFromToken(tokenC);

      // Resolve usera's household.
      const membershipA = await householdsService.findMembershipByUser(
        userIdFromToken(tokenA),
      );
      householdAId = (
        membershipA!.householdId as unknown as Types.ObjectId
      ).toString();

      // usera creates a subscription that lives in household A.
      const subRes = await request(app.getHttpServer())
        .post('/api/subscriptions')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          name: 'Shared Family Netflix',
          cost: 19.99,
          billingCycle: 'monthly',
          nextBillingDate: '2026-08-01',
          category: 'Streaming',
        })
        .expect(201);
      sharedSubId = subRes.body._id;

      // Move userc into household A: deactivate their own active membership
      // (the partial unique index allows only one active membership per user),
      // then add them as an active member of household A.
      await memberModel
        .updateMany(
          {
            userId: new Types.ObjectId(userCId),
            status: MembershipStatus.ACTIVE,
          } as Record<string, unknown>,
          { status: MembershipStatus.INVITED },
        )
        .exec();
      await householdsService.addMember({
        householdId: householdAId,
        userId: userCId,
        role: HouseholdRole.ADULT,
        status: MembershipStatus.ACTIVE,
      });
    });

    it('lets a co-member of the household see the shared subscription', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/subscriptions?limit=0')
        .set('Authorization', `Bearer ${tokenC}`)
        .expect(200);

      const ids = res.body.data.map((s: any) => s._id);
      expect(ids).toContain(sharedSubId);
    });

    it('lets a co-member read and update a household subscription', async () => {
      await request(app.getHttpServer())
        .get(`/api/subscriptions/${sharedSubId}`)
        .set('Authorization', `Bearer ${tokenC}`)
        .expect(200);

      const res = await request(app.getHttpServer())
        .patch(`/api/subscriptions/${sharedSubId}`)
        .set('Authorization', `Bearer ${tokenC}`)
        .send({ cost: 24.99 })
        .expect(200);
      expect(res.body.cost).toBe(24.99);
    });

    it('isolates a member of a different household (cannot read)', async () => {
      await request(app.getHttpServer())
        .get(`/api/subscriptions/${sharedSubId}`)
        .set('Authorization', `Bearer ${tokenB}`)
        .expect(404);
    });

    it('isolates a member of a different household (cannot update)', async () => {
      await request(app.getHttpServer())
        .patch(`/api/subscriptions/${sharedSubId}`)
        .set('Authorization', `Bearer ${tokenB}`)
        .send({ name: 'Hijacked' })
        .expect(404);
    });

    it('isolates a member of a different household (cannot delete)', async () => {
      await request(app.getHttpServer())
        .delete(`/api/subscriptions/${sharedSubId}`)
        .set('Authorization', `Bearer ${tokenB}`)
        .expect(404);

      // Still visible to the owning household.
      await request(app.getHttpServer())
        .get(`/api/subscriptions/${sharedSubId}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);
    });

    it('lets a co-member delete a household subscription', async () => {
      await request(app.getHttpServer())
        .delete(`/api/subscriptions/${sharedSubId}`)
        .set('Authorization', `Bearer ${tokenC}`)
        .expect(204);

      // Gone for the original creator too — it was shared household data.
      await request(app.getHttpServer())
        .get(`/api/subscriptions/${sharedSubId}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(404);
    });
  });
});
