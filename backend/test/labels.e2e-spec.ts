import { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { createTestApp, closeTestApp } from './helpers/test-app';
import { userIdFromToken } from './helpers/jwt';
import { HouseholdsService } from '../src/households/households.service';
import { Category } from '../src/categories/schemas/category.schema';

describe('Labels (e2e)', () => {
  let app: INestApplication<App>;
  let token: string;
  let tokenB: string;
  let householdId: string;
  let expenseCategoryId: string;

  const auth = (req: request.Test, t: string = token) =>
    req.set('Authorization', `Bearer ${t}`);

  function listLabels(includeArchived = false, t: string = token) {
    return auth(
      request(app.getHttpServer()).get(
        `/api/labels${includeArchived ? '?includeArchived=true' : ''}`,
      ),
      t,
    ).expect(200);
  }

  async function createLabel(
    body: Record<string, unknown>,
    t: string = token,
  ): Promise<string> {
    const res = await auth(request(app.getHttpServer()).post('/api/labels'), t)
      .send({ color: '#336699', ...body })
      .expect(201);
    return res.body._id;
  }

  async function createAccount(name: string): Promise<string> {
    const res = await auth(request(app.getHttpServer()).post('/api/accounts'))
      .send({ name, type: 'checking', balanceCents: 10000 })
      .expect(201);
    return res.body._id;
  }

  beforeAll(async () => {
    app = await createTestApp();
    const res = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ username: 'labeluser', password: 'Password123' });
    token = res.body.access_token;
    const resB = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ username: 'labeluserb', password: 'Password123' });
    tokenB = resB.body.access_token;

    const membership = await app
      .get(HouseholdsService)
      .findMembershipByUser(userIdFromToken(token));
    householdId = (
      membership!.householdId as { toString(): string }
    ).toString();

    const categoryModel = app.get<Model<Category>>(
      getModelToken(Category.name),
    );
    const category = await categoryModel
      .findOne({ householdId, isIncome: false } as Record<string, unknown>)
      .exec();
    expenseCategoryId = (category!._id as { toString(): string }).toString();
  });

  afterAll(async () => {
    await closeTestApp(app);
  });

  describe('authentication', () => {
    it.each([
      ['get', '/api/labels'],
      ['post', '/api/labels'],
      ['patch', '/api/labels/507f191e810c19729de860ea'],
      ['delete', '/api/labels/507f191e810c19729de860ea'],
    ] as const)('requires a token: %s %s', async (method, path) => {
      await request(app.getHttpServer())[method](path).expect(401);
    });
  });

  describe('POST /api/labels', () => {
    it('creates a label and lists it', async () => {
      const id = await createLabel({ name: 'Consulting', color: '#112233' });

      const res = await listLabels();
      const created = res.body.find((l: { _id: string }) => l._id === id);
      expect(created).toMatchObject({
        name: 'Consulting',
        color: '#112233',
        isArchived: false,
      });
      // householdId comes from the guard, never the body.
      expect(created.householdId).toBe(householdId);
      expect(created.parentId).toBeUndefined();
    });

    it('trims the name', async () => {
      const id = await createLabel({ name: '  Rentals  ' });
      const res = await listLabels();
      expect(res.body.find((l: { _id: string }) => l._id === id).name).toBe(
        'Rentals',
      );
    });

    it('lists labels sorted by name, ignoring case', async () => {
      await createLabel({ name: 'zeta sort' });
      await createLabel({ name: 'Alpha sort' });
      await createLabel({ name: 'beta sort' });

      const res = await listLabels();
      const names = res.body
        .map((l: { name: string }) => l.name)
        .filter((n: string) => n.endsWith(' sort'));
      expect(names).toEqual(['Alpha sort', 'beta sort', 'zeta sort']);
    });

    it('rejects a missing or blank name, a bad color and unknown fields', async () => {
      const post = () => auth(request(app.getHttpServer()).post('/api/labels'));
      await post().send({ color: '#336699' }).expect(400);
      await post().send({ name: '   ', color: '#336699' }).expect(400);
      await post().send({ name: 'No color' }).expect(400);
      await post().send({ name: 'Bad color', color: 'blue' }).expect(400);
      await post().send({ name: 'Short hex', color: '#abc' }).expect(400);
      await post()
        .send({
          name: 'Sneaky',
          color: '#336699',
          householdId: '507f191e810c19729de860ea',
        })
        .expect(400);
    });

    it('returns 409 for a name that differs only by case', async () => {
      await createLabel({ name: 'Side Gig' });

      const res = await auth(request(app.getHttpServer()).post('/api/labels'))
        .send({ name: 'side gig', color: '#336699' })
        .expect(409);
      expect(res.body.message).toBe(
        'A label with this name already exists in this household (possibly archived)',
      );
    });

    it('allows the same name in another household', async () => {
      await createLabel({ name: 'Shared Name' });
      await createLabel({ name: 'Shared Name' }, tokenB);
    });

    it('creates a child label under a parent in the household', async () => {
      const parent = await createLabel({ name: 'Parent Co' });
      const child = await createLabel({ name: 'Child Co', parentId: parent });

      const res = await listLabels();
      expect(
        res.body.find((l: { _id: string }) => l._id === child).parentId,
      ).toBe(parent);
    });

    it("rejects another household's label as parent with 400", async () => {
      const foreign = await createLabel({ name: 'Foreign Parent' }, tokenB);

      await auth(request(app.getHttpServer()).post('/api/labels'))
        .send({ name: 'Orphan', color: '#336699', parentId: foreign })
        .expect(400);
    });
  });

  describe('GET /api/labels?includeArchived', () => {
    it('hides archived labels unless includeArchived=true', async () => {
      const id = await createLabel({ name: 'Retired Biz' });
      await auth(request(app.getHttpServer()).patch(`/api/labels/${id}`))
        .send({ isArchived: true })
        .expect(200);

      const visible = await listLabels();
      expect(visible.body.some((l: { _id: string }) => l._id === id)).toBe(
        false,
      );
      const all = await listLabels(true);
      const archived = all.body.find((l: { _id: string }) => l._id === id);
      expect(archived.isArchived).toBe(true);
    });
  });

  describe('PATCH /api/labels/:id', () => {
    it('renames and recolors', async () => {
      const id = await createLabel({ name: 'Old Name' });

      const res = await auth(
        request(app.getHttpServer()).patch(`/api/labels/${id}`),
      )
        .send({ name: 'New Name', color: '#00ff00' })
        .expect(200);
      expect(res.body).toMatchObject({ name: 'New Name', color: '#00ff00' });
    });

    it('rejects a string "false" for isArchived and a null name', async () => {
      const id = await createLabel({ name: 'Strict Patch' });
      await auth(request(app.getHttpServer()).patch(`/api/labels/${id}`))
        .send({ isArchived: 'false' })
        .expect(400);
      await auth(request(app.getHttpServer()).patch(`/api/labels/${id}`))
        .send({ name: null })
        .expect(400);
    });

    it('returns 409 when a rename collides ignoring case', async () => {
      await createLabel({ name: 'Taken Name' });
      const id = await createLabel({ name: 'Free Name' });

      await auth(request(app.getHttpServer()).patch(`/api/labels/${id}`))
        .send({ name: 'TAKEN NAME' })
        .expect(409);
    });

    it('sets and clears a parent', async () => {
      const parent = await createLabel({ name: 'Patch Parent' });
      const id = await createLabel({ name: 'Patch Child' });

      const set = await auth(
        request(app.getHttpServer()).patch(`/api/labels/${id}`),
      )
        .send({ parentId: parent })
        .expect(200);
      expect(set.body.parentId).toBe(parent);

      const cleared = await auth(
        request(app.getHttpServer()).patch(`/api/labels/${id}`),
      )
        .send({ parentId: null })
        .expect(200);
      expect(cleared.body.parentId).toBeUndefined();
    });

    it('rejects a label as its own parent or under its own descendant', async () => {
      const top = await createLabel({ name: 'Loop Top' });
      const middle = await createLabel({ name: 'Loop Middle', parentId: top });
      const bottom = await createLabel({
        name: 'Loop Bottom',
        parentId: middle,
      });

      await auth(request(app.getHttpServer()).patch(`/api/labels/${top}`))
        .send({ parentId: top })
        .expect(400);
      await auth(request(app.getHttpServer()).patch(`/api/labels/${top}`))
        .send({ parentId: bottom })
        .expect(400);
    });

    it("returns 404 for another household's label", async () => {
      const foreign = await createLabel({ name: 'Not Yours' }, tokenB);

      await auth(request(app.getHttpServer()).patch(`/api/labels/${foreign}`))
        .send({ name: 'Hijacked' })
        .expect(404);
    });

    it('returns 400 for a malformed id', async () => {
      await auth(request(app.getHttpServer()).patch('/api/labels/not-an-id'))
        .send({ name: 'Whatever' })
        .expect(400);
    });
  });

  describe('DELETE /api/labels/:id (archive vs delete)', () => {
    it('hard-deletes an unreferenced label', async () => {
      const id = await createLabel({ name: 'Ephemeral' });

      const res = await auth(
        request(app.getHttpServer()).delete(`/api/labels/${id}`),
      ).expect(200);
      expect(res.body).toEqual({ outcome: 'deleted' });

      const all = await listLabels(true);
      expect(all.body.some((l: { _id: string }) => l._id === id)).toBe(false);
    });

    it('archives a label referenced by a transaction, which keeps its labelId', async () => {
      const id = await createLabel({ name: 'Txn Referenced' });
      const accountId = await createAccount('Label Checking');
      const txn = await auth(
        request(app.getHttpServer()).post('/api/transactions'),
      )
        .send({
          accountId,
          type: 'expense',
          amountCents: 500,
          date: '2026-07-01',
          categoryId: expenseCategoryId,
          labelId: id,
        })
        .expect(201);

      const res = await auth(
        request(app.getHttpServer()).delete(`/api/labels/${id}`),
      ).expect(200);
      expect(res.body).toEqual({ outcome: 'archived' });

      const all = await listLabels(true);
      expect(
        all.body.find((l: { _id: string }) => l._id === id).isArchived,
      ).toBe(true);
      const kept = await auth(
        request(app.getHttpServer()).get(`/api/transactions/${txn.body._id}`),
      ).expect(200);
      expect(kept.body.labelId).toBe(id);
    });

    it('archives a label referenced by a recurring template', async () => {
      const id = await createLabel({ name: 'Recurring Referenced' });
      const accountId = await createAccount('Label Bills');
      const schedule = await auth(
        request(app.getHttpServer()).post('/api/recurring'),
      )
        .send({
          accountId,
          categoryId: expenseCategoryId,
          type: 'expense',
          amountCents: 1999,
          payee: 'Coworking',
          cadence: 'monthly',
          nextDate: '2027-01-01',
          labelId: id,
        })
        .expect(201);

      const res = await auth(
        request(app.getHttpServer()).delete(`/api/labels/${id}`),
      ).expect(200);
      expect(res.body).toEqual({ outcome: 'archived' });

      const kept = await auth(
        request(app.getHttpServer()).get(`/api/recurring/${schedule.body._id}`),
      ).expect(200);
      expect(kept.body.labelId).toBe(id);
    });

    it('archives a label referenced by a goal', async () => {
      const id = await createLabel({ name: 'Goal Referenced' });
      const goal = await auth(request(app.getHttpServer()).post('/api/goals'))
        .send({
          name: 'New laptop',
          type: 'savings',
          targetCents: 200000,
          labelId: id,
        })
        .expect(201);

      const res = await auth(
        request(app.getHttpServer()).delete(`/api/labels/${id}`),
      ).expect(200);
      expect(res.body).toEqual({ outcome: 'archived' });

      const kept = await auth(
        request(app.getHttpServer()).get(`/api/goals/${goal.body._id}`),
      ).expect(200);
      expect(kept.body.labelId).toBe(id);
    });

    it('returns 409 for a label with a child', async () => {
      const parent = await createLabel({ name: 'Has Child' });
      await createLabel({ name: 'The Child', parentId: parent });

      const res = await auth(
        request(app.getHttpServer()).delete(`/api/labels/${parent}`),
      ).expect(409);
      expect(res.body.message).toBe('Re-parent or delete child labels first');
    });

    it("returns 404 for another household's label", async () => {
      const foreign = await createLabel({ name: 'Keep Out' }, tokenB);

      await auth(
        request(app.getHttpServer()).delete(`/api/labels/${foreign}`),
      ).expect(404);
      const theirs = await listLabels(false, tokenB);
      expect(theirs.body.some((l: { _id: string }) => l._id === foreign)).toBe(
        true,
      );
    });

    it('returns 400 for a malformed id', async () => {
      await auth(
        request(app.getHttpServer()).delete('/api/labels/not-an-id'),
      ).expect(400);
    });
  });
});
