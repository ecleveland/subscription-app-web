import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { createTestApp, closeTestApp } from './helpers/test-app';

describe('Goals (e2e)', () => {
  let app: INestApplication<App>;
  let tokenA: string;
  let tokenB: string;
  let categoryA: string;
  let categoryB: string;

  const api = () => request(app.getHttpServer());

  async function firstCategory(token: string): Promise<string> {
    const res = await api()
      .get('/api/categories')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    return res.body[0]._id;
  }

  beforeAll(async () => {
    app = await createTestApp();

    // Each registered user gets a personal household with seeded categories,
    // so the two users are the basis for the isolation checks below.
    const resA = await api()
      .post('/api/auth/register')
      .send({ username: 'goala', password: 'Password123' });
    tokenA = resA.body.access_token;
    const resB = await api()
      .post('/api/auth/register')
      .send({ username: 'goalb', password: 'Password123' });
    tokenB = resB.body.access_token;

    categoryA = await firstCategory(tokenA);
    categoryB = await firstCategory(tokenB);
  });

  afterAll(async () => {
    await closeTestApp(app);
  });

  describe('CRUD and contributions', () => {
    let savingsId: string;
    let debtId: string;

    it('creates a savings goal with currentCents 0 and isArchived false', async () => {
      const res = await api()
        .post('/api/goals')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          name: 'Emergency fund',
          type: 'savings',
          targetCents: 1000000,
          targetDate: '2027-06-01',
          categoryId: categoryA,
        })
        .expect(201);

      expect(res.body).toMatchObject({
        name: 'Emergency fund',
        type: 'savings',
        targetCents: 1000000,
        currentCents: 0,
        isArchived: false,
        categoryId: categoryA,
        targetDate: '2027-06-01T00:00:00.000Z',
      });
      savingsId = res.body._id;
    });

    it('creates a debt goal', async () => {
      const res = await api()
        .post('/api/goals')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ name: 'Car loan', type: 'debt', targetCents: 1500000 })
        .expect(201);

      expect(res.body.type).toBe('debt');
      expect(res.body.currentCents).toBe(0);
      debtId = res.body._id;
    });

    it('rejects currentCents on create', async () => {
      await api()
        .post('/api/goals')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          name: 'Cheat',
          type: 'savings',
          targetCents: 100,
          currentCents: 100,
        })
        .expect(400);
    });

    it('rejects a zero target and an unknown type', async () => {
      await api()
        .post('/api/goals')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ name: 'Zero', type: 'savings', targetCents: 0 })
        .expect(400);
      await api()
        .post('/api/goals')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ name: 'Odd', type: 'sinking', targetCents: 100 })
        .expect(400);
    });

    it('lists the household goals newest first', async () => {
      const res = await api()
        .get('/api/goals')
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);

      expect(res.body.map((g: { _id: string }) => g._id)).toEqual([
        debtId,
        savingsId,
      ]);
    });

    it('gets a single goal', async () => {
      const res = await api()
        .get(`/api/goals/${savingsId}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);
      expect(res.body._id).toBe(savingsId);
    });

    it('adds a contribution and returns the updated goal', async () => {
      const res = await api()
        .post(`/api/goals/${savingsId}/contributions`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ amountCents: 25000 })
        .expect(201);
      expect(res.body.currentCents).toBe(25000);
    });

    it('applies a negative correction', async () => {
      const res = await api()
        .post(`/api/goals/${savingsId}/contributions`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ amountCents: -5000 })
        .expect(201);
      expect(res.body.currentCents).toBe(20000);
    });

    it('applies concurrent contributions without losing any', async () => {
      await Promise.all(
        Array.from({ length: 5 }, () =>
          api()
            .post(`/api/goals/${debtId}/contributions`)
            .set('Authorization', `Bearer ${tokenA}`)
            .send({ amountCents: 100 })
            .expect(201),
        ),
      );
      const res = await api()
        .get(`/api/goals/${debtId}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);
      expect(res.body.currentCents).toBe(500);
    });

    it('rejects a zero or fractional contribution', async () => {
      await api()
        .post(`/api/goals/${savingsId}/contributions`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ amountCents: 0 })
        .expect(400);
      await api()
        .post(`/api/goals/${savingsId}/contributions`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ amountCents: 1.5 })
        .expect(400);
    });

    it('updates editable fields', async () => {
      const res = await api()
        .patch(`/api/goals/${savingsId}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ name: 'Rainy day', targetCents: 2000000 })
        .expect(200);

      expect(res.body.name).toBe('Rainy day');
      expect(res.body.targetCents).toBe(2000000);
      expect(res.body.currentCents).toBe(20000);
    });

    it('rejects currentCents on patch and leaves it unchanged', async () => {
      await api()
        .patch(`/api/goals/${savingsId}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ currentCents: 999999 })
        .expect(400);
      const res = await api()
        .get(`/api/goals/${savingsId}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);
      expect(res.body.currentCents).toBe(20000);
    });

    it('clears targetDate and categoryId with null', async () => {
      const res = await api()
        .patch(`/api/goals/${savingsId}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ targetDate: null, categoryId: null })
        .expect(200);

      expect(res.body.targetDate).toBeUndefined();
      expect(res.body.categoryId).toBeUndefined();
    });

    it('archives a goal out of the default list', async () => {
      await api()
        .patch(`/api/goals/${savingsId}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ isArchived: true })
        .expect(200);

      const active = await api()
        .get('/api/goals')
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);
      expect(active.body.map((g: { _id: string }) => g._id)).toEqual([debtId]);

      const explicitFalse = await api()
        .get('/api/goals?includeArchived=false')
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);
      expect(explicitFalse.body).toHaveLength(1);

      const all = await api()
        .get('/api/goals?includeArchived=true')
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);
      expect(all.body).toHaveLength(2);
    });

    it('deletes a goal (204) and then 404s', async () => {
      await api()
        .delete(`/api/goals/${debtId}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(204);
      await api()
        .get(`/api/goals/${debtId}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(404);
    });

    it('rejects a malformed id with 400', async () => {
      await api()
        .get('/api/goals/not-an-id')
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(400);
    });
  });

  describe('category ownership', () => {
    it("rejects another household's category on create", async () => {
      const res = await api()
        .post('/api/goals')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          name: 'Foreign',
          type: 'savings',
          targetCents: 100,
          categoryId: categoryB,
        })
        .expect(400);
      expect(res.body.message).toBe(
        'categoryId does not reference a category in this household',
      );
    });

    it('rejects an archived category on create', async () => {
      const cats = await api()
        .get('/api/categories')
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);
      const archivedId: string = cats.body[1]._id;
      await api()
        .patch(`/api/categories/${archivedId}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ isArchived: true })
        .expect(200);

      const res = await api()
        .post('/api/goals')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          name: 'Archived link',
          type: 'savings',
          targetCents: 100,
          categoryId: archivedId,
        })
        .expect(400);
      expect(res.body.message).toBe(
        'Cannot link a goal to an archived category',
      );
    });

    it("rejects another household's category on patch", async () => {
      const created = await api()
        .post('/api/goals')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ name: 'Mine', type: 'savings', targetCents: 100 })
        .expect(201);
      await api()
        .patch(`/api/goals/${created.body._id}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ categoryId: categoryB })
        .expect(400);
    });
  });

  describe('input coercion and trimming', () => {
    let goalId: string;

    beforeAll(async () => {
      const res = await api()
        .post('/api/goals')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ name: 'Coercion', type: 'savings', targetCents: 1000 })
        .expect(201);
      goalId = res.body._id;
    });

    it('rejects isArchived "false" as a string and leaves the goal active', async () => {
      await api()
        .patch(`/api/goals/${goalId}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ isArchived: 'false' })
        .expect(400);
      const res = await api()
        .get(`/api/goals/${goalId}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);
      expect(res.body.isArchived).toBe(false);
    });

    it('rejects a whitespace-only name on create and patch with 400', async () => {
      await api()
        .post('/api/goals')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ name: '   ', type: 'savings', targetCents: 1000 })
        .expect(400);
      await api()
        .patch(`/api/goals/${goalId}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ name: '   ' })
        .expect(400);
    });

    it('rejects a boolean or numeric-string targetCents', async () => {
      for (const targetCents of [true, '5000']) {
        await api()
          .post('/api/goals')
          .set('Authorization', `Bearer ${tokenA}`)
          .send({ name: 'Coerced', type: 'savings', targetCents })
          .expect(400);
        await api()
          .patch(`/api/goals/${goalId}`)
          .set('Authorization', `Bearer ${tokenA}`)
          .send({ targetCents })
          .expect(400);
      }
    });

    it('rejects a boolean or numeric-string contribution and leaves currentCents alone', async () => {
      for (const amountCents of [true, '5000']) {
        await api()
          .post(`/api/goals/${goalId}/contributions`)
          .set('Authorization', `Bearer ${tokenA}`)
          .send({ amountCents })
          .expect(400);
      }
      const res = await api()
        .get(`/api/goals/${goalId}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);
      expect(res.body.currentCents).toBe(0);
    });
  });

  describe('cross-household isolation', () => {
    let goalA: string;

    beforeAll(async () => {
      const res = await api()
        .post('/api/goals')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ name: 'Private', type: 'savings', targetCents: 5000 })
        .expect(201);
      goalA = res.body._id;
    });

    it("hides household A's goals from B's list", async () => {
      const res = await api()
        .get('/api/goals?includeArchived=true')
        .set('Authorization', `Bearer ${tokenB}`)
        .expect(200);
      expect(res.body).toEqual([]);
    });

    it('404s GET, PATCH, contribution and DELETE from another household', async () => {
      await api()
        .get(`/api/goals/${goalA}`)
        .set('Authorization', `Bearer ${tokenB}`)
        .expect(404);
      await api()
        .patch(`/api/goals/${goalA}`)
        .set('Authorization', `Bearer ${tokenB}`)
        .send({ name: 'Hijacked' })
        .expect(404);
      await api()
        .post(`/api/goals/${goalA}/contributions`)
        .set('Authorization', `Bearer ${tokenB}`)
        .send({ amountCents: 100 })
        .expect(404);
      await api()
        .delete(`/api/goals/${goalA}`)
        .set('Authorization', `Bearer ${tokenB}`)
        .expect(404);

      const res = await api()
        .get(`/api/goals/${goalA}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);
      expect(res.body.name).toBe('Private');
      expect(res.body.currentCents).toBe(0);
    });
  });

  describe('auth', () => {
    it('401s without a token', async () => {
      await api().get('/api/goals').expect(401);
      await api()
        .post('/api/goals')
        .send({ name: 'x', type: 'savings', targetCents: 1 })
        .expect(401);
    });
  });
});
