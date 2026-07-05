import { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { createTestApp, closeTestApp } from './helpers/test-app';
import { userIdFromToken } from './helpers/jwt';
import { CategoriesService } from '../src/categories/categories.service';
import { Household } from '../src/households/schemas/household.schema';
import { HouseholdsService } from '../src/households/households.service';

describe('Categories (e2e)', () => {
  let app: INestApplication<App>;
  let token: string;
  let tokenB: string;
  let householdId: string;

  const auth = (req: request.Test, t: string = token) =>
    req.set('Authorization', `Bearer ${t}`);

  function listCategories(includeArchived = false, t: string = token) {
    return auth(
      request(app.getHttpServer()).get(
        `/api/categories${includeArchived ? '?includeArchived=true' : ''}`,
      ),
      t,
    ).expect(200);
  }

  async function createGroup(name: string, t: string = token): Promise<string> {
    const res = await auth(
      request(app.getHttpServer()).post('/api/categories/groups'),
      t,
    )
      .send({ name })
      .expect(201);
    return res.body._id;
  }

  async function createCategory(
    body: Record<string, unknown>,
    t: string = token,
  ): Promise<string> {
    const res = await auth(
      request(app.getHttpServer()).post('/api/categories'),
      t,
    )
      .send(body)
      .expect(201);
    return res.body._id;
  }

  beforeAll(async () => {
    app = await createTestApp();
    const res = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ username: 'catuser', password: 'Password123' });
    token = res.body.access_token;
    const resB = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ username: 'catuserb', password: 'Password123' });
    tokenB = resB.body.access_token;

    const membership = await app
      .get(HouseholdsService)
      .findMembershipByUser(userIdFromToken(token));
    householdId = (
      membership!.householdId as { toString(): string }
    ).toString();
  });

  afterAll(async () => {
    await closeTestApp(app);
  });

  describe('reads', () => {
    it('lists the seeded categories for the household', async () => {
      const res = await listCategories();

      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThan(0);
      expect(res.body[0]).toMatchObject({
        name: expect.any(String),
        isIncome: expect.any(Boolean),
      });
      // Income categories are present (the seed includes a Paycheck etc.).
      expect(res.body.some((c: { isIncome: boolean }) => c.isIncome)).toBe(
        true,
      );
    });

    it('lists the seeded category groups', async () => {
      const res = await auth(
        request(app.getHttpServer()).get('/api/categories/groups'),
      ).expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThan(0);
      expect(res.body[0]).toMatchObject({ name: expect.any(String) });
    });
  });

  describe('authentication', () => {
    it.each([
      ['get', '/api/categories'],
      ['post', '/api/categories'],
      ['post', '/api/categories/reorder'],
      ['get', '/api/categories/groups'],
      ['post', '/api/categories/groups'],
      ['patch', '/api/categories/groups/507f191e810c19729de860ea'],
      ['delete', '/api/categories/groups/507f191e810c19729de860ea'],
      ['patch', '/api/categories/507f191e810c19729de860ea'],
      ['delete', '/api/categories/507f191e810c19729de860ea'],
    ] as const)('requires a token: %s %s', async (method, path) => {
      await request(app.getHttpServer())[method](path).expect(401);
    });
  });

  describe('POST /api/categories', () => {
    let groupId: string;

    beforeAll(async () => {
      groupId = await createGroup('Create Fixtures');
    });

    it('creates a category and lists it', async () => {
      const id = await createCategory({ name: 'Coffee', groupId });

      const res = await listCategories();
      const created = res.body.find((c: { _id: string }) => c._id === id);
      expect(created).toMatchObject({
        name: 'Coffee',
        groupId,
        isIncome: false,
        isArchived: false,
      });
      // householdId is server-assigned from the guard.
      expect(created.householdId).toBe(householdId);
    });

    it('appends sortOrder within the group and honors isIncome', async () => {
      const first = await createCategory({ name: 'First Income', groupId });
      const second = await createCategory({
        name: 'Second Income',
        groupId,
        isIncome: true,
      });

      const res = await listCategories();
      const byId = new Map(
        res.body.map((c: { _id: string }) => [c._id, c] as const),
      );
      const firstDoc = byId.get(first) as { sortOrder: number };
      const secondDoc = byId.get(second) as {
        sortOrder: number;
        isIncome: boolean;
      };
      expect(secondDoc.sortOrder).toBe(firstDoc.sortOrder + 1);
      expect(secondDoc.isIncome).toBe(true);
    });

    it('rejects a missing name, whitespace-only name, and malformed groupId', async () => {
      await auth(request(app.getHttpServer()).post('/api/categories'))
        .send({ groupId })
        .expect(400);
      await auth(request(app.getHttpServer()).post('/api/categories'))
        .send({ name: '   ', groupId })
        .expect(400);
      await auth(request(app.getHttpServer()).post('/api/categories'))
        .send({ name: 'Valid', groupId: 'not-an-id' })
        .expect(400);
    });

    it('rejects unknown fields (forbidNonWhitelisted)', async () => {
      await auth(request(app.getHttpServer()).post('/api/categories'))
        .send({
          name: 'Sneaky',
          groupId,
          householdId: '507f191e810c19729de860ea',
        })
        .expect(400);
    });

    it("rejects another household's group as a plain 400", async () => {
      const foreignGroup = await createGroup('B Group', tokenB);

      const res = await auth(
        request(app.getHttpServer()).post('/api/categories'),
      )
        .send({ name: 'Intruder', groupId: foreignGroup })
        .expect(400);
      expect(res.body.message).toMatch(/group in this household/);
    });

    it('409s on a duplicate name in the same group, allows it in another', async () => {
      await createCategory({ name: 'Dup Target', groupId });
      await auth(request(app.getHttpServer()).post('/api/categories'))
        .send({ name: 'Dup Target', groupId })
        .expect(409);
      // Same name, different group → fine (uniqueness is per group).
      const otherGroup = await createGroup('Other Group For Dup');
      await createCategory({ name: 'Dup Target', groupId: otherGroup });
    });
  });

  describe('PATCH /api/categories/:id', () => {
    let groupId: string;

    beforeAll(async () => {
      groupId = await createGroup('Patch Fixtures');
    });

    it('renames, reorders, moves group, archives and un-archives', async () => {
      const id = await createCategory({ name: 'Patch Me', groupId });
      const targetGroup = await createGroup('Patch Target Group');

      const renamed = await auth(
        request(app.getHttpServer()).patch(`/api/categories/${id}`),
      )
        .send({ name: 'Patched', sortOrder: 42 })
        .expect(200);
      expect(renamed.body).toMatchObject({ name: 'Patched', sortOrder: 42 });

      const moved = await auth(
        request(app.getHttpServer()).patch(`/api/categories/${id}`),
      )
        .send({ groupId: targetGroup })
        .expect(200);
      expect(moved.body.groupId).toBe(targetGroup);

      await auth(request(app.getHttpServer()).patch(`/api/categories/${id}`))
        .send({ isArchived: true })
        .expect(200);
      const visible = await listCategories();
      expect(visible.body.some((c: { _id: string }) => c._id === id)).toBe(
        false,
      );
      const all = await listCategories(true);
      expect(all.body.some((c: { _id: string }) => c._id === id)).toBe(true);

      const restored = await auth(
        request(app.getHttpServer()).patch(`/api/categories/${id}`),
      )
        .send({ isArchived: false })
        .expect(200);
      expect(restored.body.isArchived).toBe(false);
    });

    it('rejects isIncome (not patchable) and unknown fields', async () => {
      const id = await createCategory({ name: 'Immutable Income', groupId });

      await auth(request(app.getHttpServer()).patch(`/api/categories/${id}`))
        .send({ isIncome: true })
        .expect(400);
    });

    it('400s explicit JSON nulls and whitespace-only renames', async () => {
      const id = await createCategory({ name: 'Null Target', groupId });

      for (const body of [
        { name: null },
        { sortOrder: null },
        { isArchived: null },
        { groupId: null },
        { name: '   ' },
      ]) {
        await auth(request(app.getHttpServer()).patch(`/api/categories/${id}`))
          .send(body)
          .expect(400);
      }
      await auth(
        request(app.getHttpServer()).patch(`/api/categories/groups/${groupId}`),
      )
        .send({ name: null })
        .expect(400);
    });

    it('409s when renaming onto an existing name in the group', async () => {
      await createCategory({ name: 'Occupied', groupId });
      const id = await createCategory({ name: 'Renamer', groupId });

      await auth(request(app.getHttpServer()).patch(`/api/categories/${id}`))
        .send({ name: 'Occupied' })
        .expect(409);
    });

    it('400s a foreign target group, 404s a missing id, 400s a malformed id', async () => {
      const id = await createCategory({ name: 'Mover', groupId });
      const foreignGroup = await createGroup('B Patch Group', tokenB);

      await auth(request(app.getHttpServer()).patch(`/api/categories/${id}`))
        .send({ groupId: foreignGroup })
        .expect(400);
      await auth(
        request(app.getHttpServer()).patch(
          '/api/categories/507f191e810c19729de860ea',
        ),
      )
        .send({ name: 'Ghost' })
        .expect(404);
      await auth(
        request(app.getHttpServer()).patch('/api/categories/not-an-id'),
      )
        .send({ name: 'Ghost' })
        .expect(400);
    });
  });

  describe('DELETE /api/categories/:id (archive vs delete)', () => {
    let groupId: string;

    beforeAll(async () => {
      groupId = await createGroup('Delete Fixtures');
    });

    it('hard-deletes an unreferenced category', async () => {
      const id = await createCategory({ name: 'Ephemeral', groupId });

      const res = await auth(
        request(app.getHttpServer()).delete(`/api/categories/${id}`),
      ).expect(200);
      expect(res.body).toEqual({ outcome: 'deleted' });

      const all = await listCategories(true);
      expect(all.body.some((c: { _id: string }) => c._id === id)).toBe(false);
    });

    it('archives a category referenced by a transaction', async () => {
      const id = await createCategory({ name: 'Spent On', groupId });
      const account = await auth(
        request(app.getHttpServer()).post('/api/accounts'),
      )
        .send({ name: 'Del Checking', type: 'checking', balanceCents: 10000 })
        .expect(201);
      await auth(request(app.getHttpServer()).post('/api/transactions'))
        .send({
          accountId: account.body._id,
          type: 'expense',
          amountCents: 500,
          date: '2026-07-01',
          categoryId: id,
        })
        .expect(201);

      const res = await auth(
        request(app.getHttpServer()).delete(`/api/categories/${id}`),
      ).expect(200);
      expect(res.body).toEqual({ outcome: 'archived' });

      const all = await listCategories(true);
      const archived = all.body.find((c: { _id: string }) => c._id === id);
      expect(archived.isArchived).toBe(true);
      const visible = await listCategories();
      expect(visible.body.some((c: { _id: string }) => c._id === id)).toBe(
        false,
      );
    });

    it('archives a category referenced only by a budget row', async () => {
      const id = await createCategory({ name: 'Budgeted Only', groupId });
      await auth(
        request(app.getHttpServer()).put(
          `/api/budgets/2026-07/categories/${id}`,
        ),
      )
        .send({ plannedCents: 12300 })
        .expect(200);

      const res = await auth(
        request(app.getHttpServer()).delete(`/api/categories/${id}`),
      ).expect(200);
      expect(res.body).toEqual({ outcome: 'archived' });
    });

    it('404s a missing id and 400s a malformed id', async () => {
      await auth(
        request(app.getHttpServer()).delete(
          '/api/categories/507f191e810c19729de860ea',
        ),
      ).expect(404);
      await auth(
        request(app.getHttpServer()).delete('/api/categories/not-an-id'),
      ).expect(400);
    });
  });

  describe('POST /api/categories/reorder', () => {
    let groupId: string;
    let ids: string[];

    beforeAll(async () => {
      groupId = await createGroup('Reorder Fixtures');
      ids = [];
      for (const name of ['R One', 'R Two', 'R Three']) {
        ids.push(await createCategory({ name, groupId }));
      }
    });

    function orderOf(body: Array<{ _id: string; sortOrder: number }>) {
      return body
        .filter((c) => ids.includes(c._id))
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((c) => c._id);
    }

    it('applies the submitted order and returns the refreshed list', async () => {
      const reversed = [...ids].reverse();

      const res = await auth(
        request(app.getHttpServer()).post('/api/categories/reorder'),
      )
        .send({ categoryIds: reversed })
        .expect(200);

      expect(orderOf(res.body)).toEqual(reversed);
      const listed = await listCategories(true);
      expect(orderOf(listed.body)).toEqual(reversed);
    });

    it('rejects empty, duplicate-laden and malformed payloads', async () => {
      await auth(request(app.getHttpServer()).post('/api/categories/reorder'))
        .send({ categoryIds: [] })
        .expect(400);
      await auth(request(app.getHttpServer()).post('/api/categories/reorder'))
        .send({ categoryIds: [ids[0], ids[0]] })
        .expect(400);
      await auth(request(app.getHttpServer()).post('/api/categories/reorder'))
        .send({ categoryIds: ['not-an-id'] })
        .expect(400);
    });

    it("rejects the whole batch when it contains another household's id, changing nothing", async () => {
      const foreignGroup = await createGroup('B Reorder Group', tokenB);
      const foreignId = await createCategory(
        { name: 'B Cat', groupId: foreignGroup },
        tokenB,
      );
      const before = orderOf((await listCategories(true)).body);

      await auth(request(app.getHttpServer()).post('/api/categories/reorder'))
        .send({ categoryIds: [ids[0], foreignId, ids[1]] })
        .expect(400);

      const after = orderOf((await listCategories(true)).body);
      expect(after).toEqual(before);
    });
  });

  describe('category groups (write)', () => {
    it('creates a group, 409s on a duplicate name, 400s a whitespace name', async () => {
      await createGroup('Group Dup Target');
      await auth(request(app.getHttpServer()).post('/api/categories/groups'))
        .send({ name: 'Group Dup Target' })
        .expect(409);
      await auth(request(app.getHttpServer()).post('/api/categories/groups'))
        .send({ name: '   ' })
        .expect(400);
    });

    it('renames and reorders a group; 404s a missing one', async () => {
      const id = await createGroup('Group Rename Me');

      const res = await auth(
        request(app.getHttpServer()).patch(`/api/categories/groups/${id}`),
      )
        .send({ name: 'Group Renamed', sortOrder: 11 })
        .expect(200);
      expect(res.body).toMatchObject({ name: 'Group Renamed', sortOrder: 11 });

      await auth(
        request(app.getHttpServer()).patch(
          '/api/categories/groups/507f191e810c19729de860ea',
        ),
      )
        .send({ name: 'Ghost' })
        .expect(404);
    });

    it('blocks deleting a non-empty group (archived categories count)', async () => {
      const id = await createGroup('Group Occupied');
      const catId = await createCategory({ name: 'Occupier', groupId: id });

      await auth(
        request(app.getHttpServer()).delete(`/api/categories/groups/${id}`),
      ).expect(409);

      // Archive the category — the group must still be blocked.
      await auth(request(app.getHttpServer()).patch(`/api/categories/${catId}`))
        .send({ isArchived: true })
        .expect(200);
      await auth(
        request(app.getHttpServer()).delete(`/api/categories/groups/${id}`),
      ).expect(409);
    });

    it('deletes an empty group', async () => {
      const id = await createGroup('Group Ephemeral');

      await auth(
        request(app.getHttpServer()).delete(`/api/categories/groups/${id}`),
      ).expect(204);

      const res = await auth(
        request(app.getHttpServer()).get('/api/categories/groups'),
      ).expect(200);
      expect(res.body.some((g: { _id: string }) => g._id === id)).toBe(false);
    });
  });

  describe('cross-household isolation', () => {
    let groupIdA: string;
    let categoryIdA: string;

    beforeAll(async () => {
      groupIdA = await createGroup('Isolation Group A');
      categoryIdA = await createCategory({
        name: 'Isolation Cat A',
        groupId: groupIdA,
      });
    });

    it("B cannot update or delete A's category (404, unchanged)", async () => {
      await auth(
        request(app.getHttpServer()).patch(`/api/categories/${categoryIdA}`),
        tokenB,
      )
        .send({ name: 'Hijacked' })
        .expect(404);
      await auth(
        request(app.getHttpServer()).delete(`/api/categories/${categoryIdA}`),
        tokenB,
      ).expect(404);

      const res = await listCategories(true);
      const doc = res.body.find(
        (c: { _id: string }) => c._id === categoryIdA,
      ) as { name: string };
      expect(doc.name).toBe('Isolation Cat A');
    });

    it("B cannot update or delete A's group (404)", async () => {
      await auth(
        request(app.getHttpServer()).patch(
          `/api/categories/groups/${groupIdA}`,
        ),
        tokenB,
      )
        .send({ name: 'Hijacked Group' })
        .expect(404);
      await auth(
        request(app.getHttpServer()).delete(
          `/api/categories/groups/${groupIdA}`,
        ),
        tokenB,
      ).expect(404);
    });

    it("B cannot reorder using A's category ids (400)", async () => {
      await auth(
        request(app.getHttpServer()).post('/api/categories/reorder'),
        tokenB,
      )
        .send({ categoryIds: [categoryIdA] })
        .expect(400);
    });
  });

  describe('archive enforcement (ledger + budgets)', () => {
    let archivedId: string;

    beforeAll(async () => {
      const groupId = await createGroup('Archive Enforcement');
      archivedId = await createCategory({ name: 'Retired', groupId });
      await auth(
        request(app.getHttpServer()).patch(`/api/categories/${archivedId}`),
      )
        .send({ isArchived: true })
        .expect(200);
    });

    it('rejects recording a new transaction against an archived category', async () => {
      const account = await auth(
        request(app.getHttpServer()).post('/api/accounts'),
      )
        .send({ name: 'Arch Checking', type: 'checking' })
        .expect(201);

      const res = await auth(
        request(app.getHttpServer()).post('/api/transactions'),
      )
        .send({
          accountId: account.body._id,
          type: 'expense',
          amountCents: 500,
          date: '2026-07-01',
          categoryId: archivedId,
        })
        .expect(400);
      expect(res.body.message).toMatch(/archived category/);
    });

    it('rejects setting budget limits on an archived category (single and bulk)', async () => {
      await auth(
        request(app.getHttpServer()).put(
          `/api/budgets/2026-07/categories/${archivedId}`,
        ),
      )
        .send({ plannedCents: 1000 })
        .expect(400);

      await auth(request(app.getHttpServer()).put('/api/budgets/2026-07'))
        .send({ categories: [{ categoryId: archivedId, plannedCents: 1000 }] })
        .expect(400);
    });
  });

  describe('seeding vs user edits', () => {
    // Two seeded defaults no other test touches or references.
    const RENAME_DEFAULT = 'Gas';
    const DELETE_DEFAULT = 'Public Transit';

    async function seededByName(name: string): Promise<{ _id: string }> {
      const res = await listCategories(true);
      return res.body.find((c: { name: string }) => c.name === name) as {
        _id: string;
      };
    }

    it('a stamped household is skipped: renamed/hard-deleted defaults stay gone', async () => {
      const service = app.get(CategoriesService);

      const renameTarget = await seededByName(RENAME_DEFAULT);
      await auth(
        request(app.getHttpServer()).patch(
          `/api/categories/${renameTarget._id}`,
        ),
      )
        .send({ name: 'Fuel & Charging' })
        .expect(200);

      const deleteTarget = await seededByName(DELETE_DEFAULT);
      // The seeded default is unreferenced → hard delete.
      const del = await auth(
        request(app.getHttpServer()).delete(
          `/api/categories/${deleteTarget._id}`,
        ),
      ).expect(200);
      expect(del.body).toEqual({ outcome: 'deleted' });

      await service.backfillDefaultCategories();

      const after = await listCategories(true);
      const names = after.body.map((c: { name: string }) => c.name);
      expect(names).not.toContain(RENAME_DEFAULT);
      expect(names).not.toContain(DELETE_DEFAULT);
      expect(names).toContain('Fuel & Charging');
    });

    it('an unstamped (crash-mid-seed) household is repaired and re-stamped', async () => {
      const service = app.get(CategoriesService);
      const householdModel = app.get<Model<Household>>(
        getModelToken(Household.name),
      );
      // Simulate a household whose seed never completed: the previous test
      // removed defaults; clearing the stamp marks it incomplete.
      await householdModel
        .updateOne({ _id: householdId } as Record<string, unknown>, {
          $unset: { defaultCategoriesSeededAt: 1 },
        })
        .exec();

      const repaired = await service.backfillDefaultCategories();
      expect(repaired).toBe(1);

      // The missing defaults are restored (an unstamped household is assumed
      // incompletely seeded — that's the self-repair contract)…
      const after = await listCategories(true);
      const names = after.body.map((c: { name: string }) => c.name);
      expect(names).toContain(RENAME_DEFAULT);
      expect(names).toContain(DELETE_DEFAULT);
      // …and the household is re-stamped so the next backfill skips it again.
      const household = await householdModel.findById(householdId).exec();
      expect(household!.defaultCategoriesSeededAt).toBeInstanceOf(Date);
    });
  });
});
