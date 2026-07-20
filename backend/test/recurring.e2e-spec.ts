import { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { createTestApp, closeTestApp } from './helpers/test-app';
import { userIdFromToken } from './helpers/jwt';
import { HouseholdsService } from '../src/households/households.service';
import { Category } from '../src/categories/schemas/category.schema';
import { Transaction } from '../src/transactions/schemas/transaction.schema';
import { RecurringService } from '../src/recurring/recurring.service';

async function createAccount(
  app: INestApplication<App>,
  token: string,
  body: Record<string, unknown>,
): Promise<string> {
  const res = await request(app.getHttpServer())
    .post('/api/accounts')
    .set('Authorization', `Bearer ${token}`)
    .send(body)
    .expect(201);
  return res.body._id;
}

describe('Recurring (e2e)', () => {
  let app: INestApplication<App>;
  let tokenA: string;
  let tokenB: string;
  let categoryModel: Model<Category>;
  let transactionModel: Model<Transaction>;

  // Household A fixtures.
  let householdIdA: string;
  let memberIdA: string;
  let expenseCatA: string;
  let incomeCatA: string;
  let checkingA: string;
  let archivedAccountA: string;
  let archivedCatA: string;

  // Household B fixtures (cross-household isolation).
  let bAccount: string;
  let bCategory: string;

  async function seededCategory(
    householdId: string,
    isIncome: boolean,
  ): Promise<string> {
    const cat = await categoryModel
      .findOne({ householdId, isIncome } as Record<string, unknown>)
      .exec();
    return (cat!._id as { toString(): string }).toString();
  }

  // A well-formed create body for household A; override per test.
  const validBody = (overrides: Record<string, unknown> = {}) => ({
    accountId: checkingA,
    categoryId: expenseCatA,
    type: 'expense',
    amountCents: 1999,
    payee: 'Netflix',
    cadence: 'monthly',
    nextDate: '2026-08-01',
    ...overrides,
  });

  async function createSchedule(
    token: string,
    overrides: Record<string, unknown> = {},
  ): Promise<Record<string, any>> {
    const res = await request(app.getHttpServer())
      .post('/api/recurring')
      .set('Authorization', `Bearer ${token}`)
      .send(validBody(overrides))
      .expect(201);
    return res.body;
  }

  beforeAll(async () => {
    app = await createTestApp();
    categoryModel = app.get<Model<Category>>(getModelToken(Category.name));
    transactionModel = app.get<Model<Transaction>>(
      getModelToken(Transaction.name),
    );
    const households = app.get(HouseholdsService);

    const resA = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ username: 'usera', password: 'Password123' });
    tokenA = resA.body.access_token;
    const resB = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ username: 'userb', password: 'Password123' });
    tokenB = resB.body.access_token;

    const membershipA = await households.findMembershipByUser(
      userIdFromToken(tokenA),
    );
    householdIdA = (
      membershipA!.householdId as { toString(): string }
    ).toString();
    memberIdA = membershipA!._id.toString();
    expenseCatA = await seededCategory(householdIdA, false);
    incomeCatA = await seededCategory(householdIdA, true);
    checkingA = await createAccount(app, tokenA, {
      name: 'Checking',
      type: 'checking',
    });

    // Archived fixtures: created via the API, then archived via PATCH.
    archivedAccountA = await createAccount(app, tokenA, {
      name: 'Old account',
      type: 'checking',
    });
    await request(app.getHttpServer())
      .patch(`/api/accounts/${archivedAccountA}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ isArchived: true })
      .expect(200);

    const catRes = await request(app.getHttpServer())
      .post('/api/categories')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        name: 'Defunct',
        groupId: (
          (await categoryModel.findById(expenseCatA).exec())!
            .groupId as unknown as Types.ObjectId
        ).toString(),
      })
      .expect(201);
    archivedCatA = catRes.body._id;
    await request(app.getHttpServer())
      .patch(`/api/categories/${archivedCatA}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ isArchived: true })
      .expect(200);

    const membershipB = await households.findMembershipByUser(
      userIdFromToken(tokenB),
    );
    const householdIdB = (
      membershipB!.householdId as { toString(): string }
    ).toString();
    bCategory = await seededCategory(householdIdB, false);
    bAccount = await createAccount(app, tokenB, {
      name: 'B Checking',
      type: 'checking',
    });
  });

  afterAll(async () => {
    await closeTestApp(app);
  });

  describe('POST /api/recurring', () => {
    it('401s without a token', async () => {
      await request(app.getHttpServer())
        .post('/api/recurring')
        .send(validBody())
        .expect(401);
    });

    it('creates an expense bill with schema defaults applied', async () => {
      const body = await createSchedule(tokenA);
      expect(body.type).toBe('expense');
      expect(body.amountCents).toBe(1999);
      expect(body.payee).toBe('Netflix');
      expect(body.isActive).toBe(true);
      expect(body.isSubscription).toBe(false);
      expect(body.reminderDaysBefore).toBe(3);
      expect(body.tags).toEqual([]);
      expect(body.householdId).toBe(householdIdA);
      // Attribution comes from the guard-resolved membership, never the body.
      expect(body.memberId).toBe(memberIdA);
    });

    it('creates a scheduled income (paycheck)', async () => {
      const body = await createSchedule(tokenA, {
        type: 'income',
        categoryId: incomeCatA,
        payee: 'Employer',
        amountCents: 250000,
        cadence: 'monthly',
      });
      expect(body.type).toBe('income');
    });

    it('creates an expense subscription', async () => {
      const body = await createSchedule(tokenA, {
        isSubscription: true,
        payee: 'Spotify',
      });
      expect(body.isSubscription).toBe(true);
    });

    it('accepts sharedWith: null (legacy "not shared" wire value)', async () => {
      const body = await createSchedule(tokenA, {
        sharedWith: null,
        payee: 'Solo plan',
      });
      expect(body.sharedWith).toBeUndefined();
    });

    it('rejects an income subscription', async () => {
      await request(app.getHttpServer())
        .post('/api/recurring')
        .set('Authorization', `Bearer ${tokenA}`)
        .send(
          validBody({
            type: 'income',
            categoryId: incomeCatA,
            isSubscription: true,
          }),
        )
        .expect(400);
    });

    it.each([
      ['missing accountId', { accountId: undefined }],
      ['float amountCents', { amountCents: 19.99 }],
      ['zero amountCents', { amountCents: 0 }],
      ['unknown cadence', { cadence: 'daily' }],
      ['missing nextDate', { nextDate: undefined }],
      ['reminderDaysBefore above bound', { reminderDaysBefore: 31 }],
      ['explicit-null reminderDaysBefore', { reminderDaysBefore: null }],
      ['whitespace-only payee', { payee: '   ' }],
      ['unknown field', { billingCycle: 'monthly' }],
      ['endDate before nextDate', { endDate: '2026-07-31' }],
      ['sharedWith below 2', { sharedWith: 1 }],
      ['ISO week-date nextDate JS cannot parse', { nextDate: '2026-W32' }],
      ['ISO ordinal endDate JS cannot parse', { endDate: '2026-213' }],
      // The string "false" would implicitly coerce to boolean true without
      // the raw-value transform — reject it rather than invert it.
      ['string-boolean isActive', { isActive: 'false' }],
      ['string-boolean isSubscription', { isSubscription: 'false' }],
      // Number(true) === 1 under implicit conversion — a stray boolean must
      // not persist a 1-cent schedule or a 1-day reminder.
      ['boolean amountCents', { amountCents: true }],
      ['boolean reminderDaysBefore', { reminderDaysBefore: true }],
      // @IsOptional would skip explicit null, persisting tags: null (the
      // schema default only applies to undefined) — reject like the PATCH DTO.
      ['explicit-null tags', { tags: null }],
      ['explicit-null notes', { notes: null }],
    ])('rejects %s with 400', async (_label, overrides) => {
      await request(app.getHttpServer())
        .post('/api/recurring')
        .set('Authorization', `Bearer ${tokenA}`)
        .send(validBody(overrides))
        .expect(400);
    });

    it('accepts endDate equal to nextDate (one final occurrence)', async () => {
      await createSchedule(tokenA, {
        endDate: '2026-08-01',
        payee: 'Final run',
      });
    });

    it('compares the date pair at day granularity, not instants', async () => {
      await createSchedule(tokenA, {
        nextDate: '2026-08-01T12:00:00.000Z',
        endDate: '2026-08-01',
        payee: 'Same-day finale',
      });
    });

    it('accepts endDate: null as "no end date"', async () => {
      const body = await createSchedule(tokenA, {
        endDate: null,
        payee: 'Open-ended',
      });
      expect(body.endDate).toBeUndefined();
    });

    it("rejects household B's accountId with 400 (not 404)", async () => {
      await request(app.getHttpServer())
        .post('/api/recurring')
        .set('Authorization', `Bearer ${tokenA}`)
        .send(validBody({ accountId: bAccount }))
        .expect(400);
    });

    it("rejects household B's categoryId with 400", async () => {
      await request(app.getHttpServer())
        .post('/api/recurring')
        .set('Authorization', `Bearer ${tokenA}`)
        .send(validBody({ categoryId: bCategory }))
        .expect(400);
    });

    it('rejects an archived account', async () => {
      await request(app.getHttpServer())
        .post('/api/recurring')
        .set('Authorization', `Bearer ${tokenA}`)
        .send(validBody({ accountId: archivedAccountA }))
        .expect(400);
    });

    it('rejects an archived category', async () => {
      await request(app.getHttpServer())
        .post('/api/recurring')
        .set('Authorization', `Bearer ${tokenA}`)
        .send(validBody({ categoryId: archivedCatA }))
        .expect(400);
    });
  });

  describe('GET /api/recurring', () => {
    let early: string;
    let late: string;

    beforeAll(async () => {
      early = (
        await createSchedule(tokenA, {
          payee: 'Rent',
          nextDate: '2026-07-15',
        })
      )._id;
      late = (
        await createSchedule(tokenA, {
          payee: 'Insurance',
          nextDate: '2026-12-01',
        })
      )._id;
      await createSchedule(tokenB, {
        accountId: bAccount,
        categoryId: bCategory,
        payee: 'B bill',
      });
    });

    it('lists only the household schedules, next-due first', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/recurring')
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);

      const ids = res.body.map((s: { _id: string }) => s._id);
      expect(ids).toContain(early);
      expect(ids).toContain(late);
      expect(ids.indexOf(early)).toBeLessThan(ids.indexOf(late));
      const dates = res.body.map((s: { nextDate: string }) => s.nextDate);
      expect([...dates].sort()).toEqual(dates);
      for (const s of res.body) {
        expect(s.householdId).toBe(householdIdA);
      }
      expect(res.body.map((s: { payee: string }) => s.payee)).not.toContain(
        'B bill',
      );
    });

    it('filters by type', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/recurring?type=income')
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);
      expect(res.body.length).toBeGreaterThan(0);
      for (const s of res.body) {
        expect(s.type).toBe('income');
      }
    });

    it('rejects the transfer type (schedules are income/expense only)', async () => {
      await request(app.getHttpServer())
        .get('/api/recurring?type=transfer')
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(400);
    });

    it('filters by isSubscription=true', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/recurring?isSubscription=true')
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);
      expect(res.body.length).toBeGreaterThan(0);
      for (const s of res.body) {
        expect(s.isSubscription).toBe(true);
      }
    });

    it('filters by isSubscription=false (string "false" must not coerce to true)', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/recurring?isSubscription=false')
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);
      expect(res.body.length).toBeGreaterThan(0);
      for (const s of res.body) {
        expect(s.isSubscription).toBe(false);
      }
    });

    it('rejects a non-boolean isSubscription value', async () => {
      await request(app.getHttpServer())
        .get('/api/recurring?isSubscription=banana')
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(400);
    });

    it('filters by isActive=false (paused schedules only)', async () => {
      const paused = await createSchedule(tokenA, { payee: 'Paused bill' });
      await request(app.getHttpServer())
        .patch(`/api/recurring/${paused._id}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ isActive: false })
        .expect(200);

      const res = await request(app.getHttpServer())
        .get('/api/recurring?isActive=false')
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);
      expect(res.body.length).toBeGreaterThan(0);
      for (const s of res.body) {
        expect(s.isActive).toBe(false);
      }
    });

    it('filters by accountId and categoryId', async () => {
      const other = await createAccount(app, tokenA, {
        name: 'Second',
        type: 'savings',
      });
      const onOther = await createSchedule(tokenA, {
        accountId: other,
        payee: 'On second account',
      });

      const byAccount = await request(app.getHttpServer())
        .get(`/api/recurring?accountId=${other}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);
      expect(byAccount.body.map((s: { _id: string }) => s._id)).toEqual([
        onOther._id,
      ]);

      const byCategory = await request(app.getHttpServer())
        .get(`/api/recurring?categoryId=${incomeCatA}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);
      expect(byCategory.body.length).toBeGreaterThan(0);
      for (const s of byCategory.body) {
        expect(s.categoryId).toBe(incomeCatA);
      }
    });
  });

  describe('GET /api/recurring/:id', () => {
    let scheduleId: string;

    beforeAll(async () => {
      scheduleId = (await createSchedule(tokenA, { payee: 'Fetch me' }))._id;
    });

    it('returns an owned schedule', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/recurring/${scheduleId}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);
      expect(res.body.payee).toBe('Fetch me');
    });

    it('400s on a malformed id (ParseObjectIdPipe)', async () => {
      await request(app.getHttpServer())
        .get('/api/recurring/not-an-id')
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(400);
    });

    it('404s on a well-formed unknown id', async () => {
      await request(app.getHttpServer())
        .get(`/api/recurring/${new Types.ObjectId().toString()}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(404);
    });

    it("404s when household B requests A's schedule (no existence leak)", async () => {
      await request(app.getHttpServer())
        .get(`/api/recurring/${scheduleId}`)
        .set('Authorization', `Bearer ${tokenB}`)
        .expect(404);
    });
  });

  describe('PATCH /api/recurring/:id', () => {
    let scheduleId: string;

    beforeEach(async () => {
      scheduleId = (
        await createSchedule(tokenA, {
          payee: 'Patch me',
          endDate: '2026-12-31',
        })
      )._id;
    });

    it('applies a partial update and leaves other fields intact', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/recurring/${scheduleId}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ amountCents: 2499 })
        .expect(200);
      expect(res.body.amountCents).toBe(2499);
      expect(res.body.payee).toBe('Patch me');
      expect(res.body.cadence).toBe('monthly');
    });

    it('pauses and resumes via isActive', async () => {
      const paused = await request(app.getHttpServer())
        .patch(`/api/recurring/${scheduleId}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ isActive: false })
        .expect(200);
      expect(paused.body.isActive).toBe(false);

      const resumed = await request(app.getHttpServer())
        .patch(`/api/recurring/${scheduleId}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ isActive: true })
        .expect(200);
      expect(resumed.body.isActive).toBe(true);
    });

    it.each([
      ['null nextDate', { nextDate: null }],
      ['null payee', { payee: null }],
      ['null reminderDaysBefore', { reminderDaysBefore: null }],
      ['null type', { type: null }],
      ['null cadence', { cadence: null }],
      ['null accountId', { accountId: null }],
      ['null categoryId', { categoryId: null }],
      ['null amountCents', { amountCents: null }],
      ['null tags', { tags: null }],
      ['null isActive', { isActive: null }],
      ['null isSubscription', { isSubscription: null }],
      ['float amountCents', { amountCents: 10.5 }],
      ['boolean amountCents', { amountCents: true }],
      ['whitespace-only payee', { payee: '   ' }],
      ['string-boolean isSubscription', { isSubscription: 'false' }],
      ['unknown field', { billingCycle: 'monthly' }],
    ])('rejects %s with 400 (never a Mongoose 500)', async (_l, patch) => {
      await request(app.getHttpServer())
        .patch(`/api/recurring/${scheduleId}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send(patch)
        .expect(400);
    });

    it('clears endDate on explicit null', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/recurring/${scheduleId}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ endDate: null })
        .expect(200);
      expect(res.body.endDate).toBeUndefined();
    });

    it('clears sharedWith on explicit null', async () => {
      await request(app.getHttpServer())
        .patch(`/api/recurring/${scheduleId}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ sharedWith: 3 })
        .expect(200);
      const res = await request(app.getHttpServer())
        .patch(`/api/recurring/${scheduleId}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ sharedWith: null })
        .expect(200);
      expect(res.body.sharedWith).toBeUndefined();
    });

    it('rejects an endDate before nextDate', async () => {
      await request(app.getHttpServer())
        .patch(`/api/recurring/${scheduleId}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ endDate: '2026-01-01' })
        .expect(400);
    });

    it('rejects moving nextDate past the stored endDate', async () => {
      // The fixture's endDate is 2026-12-31; the merged state must reject a
      // nextDate beyond it even though the patch never mentions endDate.
      await request(app.getHttpServer())
        .patch(`/api/recurring/${scheduleId}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ nextDate: '2027-01-15' })
        .expect(400);
    });

    it('400s on a malformed id', async () => {
      await request(app.getHttpServer())
        .patch('/api/recurring/not-an-id')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ payee: 'X' })
        .expect(400);
    });

    it('rejects switching a subscription to income', async () => {
      const sub = await createSchedule(tokenA, {
        isSubscription: true,
        payee: 'Sub to break',
      });
      await request(app.getHttpServer())
        .patch(`/api/recurring/${sub._id}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ type: 'income', categoryId: incomeCatA })
        .expect(400);
    });

    it('rejects reactivating a paused schedule whose account is now archived', async () => {
      const doomed = await createAccount(app, tokenA, {
        name: 'Doomed',
        type: 'checking',
      });
      const schedule = await createSchedule(tokenA, {
        accountId: doomed,
        payee: 'On doomed account',
      });
      await request(app.getHttpServer())
        .patch(`/api/recurring/${schedule._id}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ isActive: false })
        .expect(200);
      await request(app.getHttpServer())
        .patch(`/api/accounts/${doomed}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ isArchived: true })
        .expect(200);

      await request(app.getHttpServer())
        .patch(`/api/recurring/${schedule._id}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ isActive: true })
        .expect(400);
      // Other corrections on the paused schedule stay allowed.
      await request(app.getHttpServer())
        .patch(`/api/recurring/${schedule._id}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ payee: 'Still editable' })
        .expect(200);
    });

    it('rejects reactivating a paused schedule whose category is now archived', async () => {
      const catRes = await request(app.getHttpServer())
        .post('/api/categories')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          name: 'Doomed category',
          groupId: (
            (await categoryModel.findById(expenseCatA).exec())!
              .groupId as unknown as Types.ObjectId
          ).toString(),
        })
        .expect(201);
      const doomedCat = catRes.body._id;
      const schedule = await createSchedule(tokenA, {
        categoryId: doomedCat,
        payee: 'On doomed category',
      });
      await request(app.getHttpServer())
        .patch(`/api/recurring/${schedule._id}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ isActive: false })
        .expect(200);
      await request(app.getHttpServer())
        .patch(`/api/categories/${doomedCat}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ isArchived: true })
        .expect(200);

      await request(app.getHttpServer())
        .patch(`/api/recurring/${schedule._id}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ isActive: true })
        .expect(400);
    });

    it("rejects re-pointing at household B's account with 400", async () => {
      await request(app.getHttpServer())
        .patch(`/api/recurring/${scheduleId}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ accountId: bAccount })
        .expect(400);
    });

    it('rejects re-pointing at an archived category', async () => {
      await request(app.getHttpServer())
        .patch(`/api/recurring/${scheduleId}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ categoryId: archivedCatA })
        .expect(400);
    });

    it("404s when household B patches A's schedule", async () => {
      await request(app.getHttpServer())
        .patch(`/api/recurring/${scheduleId}`)
        .set('Authorization', `Bearer ${tokenB}`)
        .send({ payee: 'Hijacked' })
        .expect(404);
    });
  });

  describe('DELETE /api/recurring/:id', () => {
    it('400s on a malformed id', async () => {
      await request(app.getHttpServer())
        .delete('/api/recurring/not-an-id')
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(400);
    });

    it('deletes an owned schedule (204, then 404 on fetch)', async () => {
      const id = (await createSchedule(tokenA, { payee: 'Delete me' }))._id;
      await request(app.getHttpServer())
        .delete(`/api/recurring/${id}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(204);
      await request(app.getHttpServer())
        .get(`/api/recurring/${id}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(404);
    });

    it('keeps materialized transactions (with their recurringId) intact', async () => {
      const id = (await createSchedule(tokenA, { payee: 'Materialized' }))._id;
      // Seed a ledger row the way the VEG-467 scheduler will: directly on the
      // model, pointing back at the schedule.
      // Doc-constructor form: model.create()'s overloads reject
      // mongoose.Types.ObjectId against the schema's prop typing under
      // strict tsc (the divergence backend-patterns.md warns about).
      const txn = await new transactionModel({
        householdId: new Types.ObjectId(householdIdA),
        accountId: new Types.ObjectId(checkingA),
        categoryId: new Types.ObjectId(expenseCatA),
        type: 'expense',
        amountCents: 1999,
        date: new Date('2026-08-01'),
        recurringId: new Types.ObjectId(id),
        tags: [],
        cleared: false,
      }).save();

      await request(app.getHttpServer())
        .delete(`/api/recurring/${id}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(204);

      const survivor = await transactionModel.findById(txn._id).exec();
      expect(survivor).not.toBeNull();
      expect(
        (
          survivor!.recurringId as unknown as Types.ObjectId | undefined
        )?.toString(),
      ).toBe(id);
    });

    it("404s when household B deletes A's schedule (and it survives)", async () => {
      const id = (await createSchedule(tokenA, { payee: 'Survivor' }))._id;
      await request(app.getHttpServer())
        .delete(`/api/recurring/${id}`)
        .set('Authorization', `Bearer ${tokenB}`)
        .expect(404);
      await request(app.getHttpServer())
        .get(`/api/recurring/${id}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);
    });
  });

  // The scheduler against a real database — the layer where the unique
  // { recurringId, date } index actually exists (buildAllIndexes runs in
  // createTestApp), so idempotency is genuinely exercised rather than mocked.
  describe('materialization scheduler (VEG-467)', () => {
    // A fixed "today" so the assertions do not drift with the wall clock.
    const NOW = new Date('2026-08-15T00:00:00Z');

    const balanceOf = async (accountId: string): Promise<number> => {
      const res = await request(app.getHttpServer())
        .get('/api/accounts')
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);
      return res.body.find((a: any) => a._id === accountId).balanceCents;
    };

    // The CRUD suites above leave many schedules behind, and every one of them
    // is due — a scheduler run touches them all. So each test here gets its own
    // account, and every assertion is scoped to its own schedule's rows rather
    // than to the run-wide summary counters.
    const scheduleOnFreshAccount = async (
      overrides: Record<string, unknown>,
    ): Promise<{ id: string; accountId: string }> => {
      const accountId = await createAccount(app, tokenA, {
        name: `Scheduler ${Math.random().toString(36).slice(2, 10)}`,
        type: 'checking',
      });
      const body = await createSchedule(tokenA, { ...overrides, accountId });
      return { id: body._id, accountId };
    };

    const ledgerFor = async (recurringId: string) =>
      transactionModel
        .find({ recurringId: new Types.ObjectId(recurringId) } as Record<
          string,
          unknown
        >)
        .sort({ date: 1 })
        .exec();

    let recurringService: RecurringService;

    beforeAll(() => {
      recurringService = app.get(RecurringService);
    });

    it('materializes a due schedule into the ledger and moves the balance', async () => {
      const { id, accountId } = await scheduleOnFreshAccount({
        payee: 'Rent',
        amountCents: 150000,
        nextDate: '2026-08-01',
      });

      await recurringService.materializeDue(NOW);

      const rows = await ledgerFor(id);
      expect(rows).toHaveLength(1);
      expect(rows[0].amountCents).toBe(150000);
      expect(rows[0].type).toBe('expense');
      expect((rows[0].categoryId as unknown as Types.ObjectId).toString()).toBe(
        expenseCatA,
      );
      // Normalized to UTC midnight — the dedupe key is per calendar day.
      expect(rows[0].date.toISOString()).toBe('2026-08-01T00:00:00.000Z');
      // A fresh account starts at zero, so the expense is the whole balance.
      expect(await balanceOf(accountId)).toBe(-150000);

      // And the schedule advanced one month.
      const after = await request(app.getHttpServer())
        .get(`/api/recurring/${id}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);
      expect(after.body.nextDate).toContain('2026-09-01');
    });

    // The ticket's headline acceptance criterion.
    it('shows the materialized transaction in budget-vs-actual', async () => {
      await createSchedule(tokenA, {
        payee: 'Utilities',
        amountCents: 8500,
        nextDate: '2026-08-05',
      });

      await recurringService.materializeDue(NOW);

      const budget = await request(app.getHttpServer())
        .get('/api/budgets/2026-08')
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);
      const row = budget.body.categories.find(
        (c: any) => c.categoryId === expenseCatA,
      );
      expect(row).toBeDefined();
      expect(row.actualCents).toBeGreaterThanOrEqual(8500);
    });

    // The crash-retry property the whole insert-first design rests on.
    it('is idempotent: a second run neither duplicates nor double-charges', async () => {
      const { id, accountId } = await scheduleOnFreshAccount({
        payee: 'Insurance',
        amountCents: 4200,
        nextDate: '2026-08-10',
      });

      await recurringService.materializeDue(NOW);
      const afterFirst = await balanceOf(accountId);
      expect(await ledgerFor(id)).toHaveLength(1);

      // Re-running the same day is a no-op: the schedule has already advanced
      // past today, so nothing is due.
      await recurringService.materializeDue(NOW);
      expect(await ledgerFor(id)).toHaveLength(1);
      expect(await balanceOf(accountId)).toBe(afterFirst);
    });

    // Simulates a crash between the insert and the nextDate advance: the row
    // exists but the schedule still points at that occurrence. The retry must
    // be absorbed by the unique index, not produce a second row.
    it('absorbs a replayed occurrence via the unique index', async () => {
      const { id, accountId } = await scheduleOnFreshAccount({
        payee: 'Replayed',
        amountCents: 3300,
        nextDate: '2026-08-12',
      });

      await recurringService.materializeDue(NOW);
      const balanceAfterFirst = await balanceOf(accountId);
      expect(await ledgerFor(id)).toHaveLength(1);

      // Rewind nextDate to the occurrence just written, as a crash would leave it.
      await request(app.getHttpServer())
        .patch(`/api/recurring/${id}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ nextDate: '2026-08-12' })
        .expect(200);

      const summary = await recurringService.materializeDue(NOW);

      // At least this schedule's replay was absorbed (other leftover schedules
      // in this database share the run).
      expect(summary.duplicate).toBeGreaterThanOrEqual(1);
      expect(await ledgerFor(id)).toHaveLength(1);
      // Critically: the balance was NOT applied twice.
      expect(await balanceOf(accountId)).toBe(balanceAfterFirst);
    });

    it('materializes one transaction per missed period when overdue', async () => {
      const { id } = await scheduleOnFreshAccount({
        payee: 'Backlog',
        amountCents: 1000,
        nextDate: '2026-05-01',
      });

      await recurringService.materializeDue(NOW);

      const rows = await ledgerFor(id);
      expect(rows.map((r) => r.date.toISOString().slice(0, 10))).toEqual([
        '2026-05-01',
        '2026-06-01',
        '2026-07-01',
        '2026-08-01',
      ]);
    });

    it('stops at endDate and deactivates the schedule', async () => {
      const { id } = await scheduleOnFreshAccount({
        payee: 'Ending',
        amountCents: 500,
        nextDate: '2026-06-01',
        endDate: '2026-07-01',
      });

      await recurringService.materializeDue(NOW);

      expect(await ledgerFor(id)).toHaveLength(2);
      const after = await request(app.getHttpServer())
        .get(`/api/recurring/${id}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);
      expect(after.body.isActive).toBe(false);
    });

    it('leaves a schedule on an archived account untouched and reactivatable', async () => {
      // Created against a live account, then the account is archived — the only
      // route into this state, since the API blocks pointing at archived refs.
      const { id, accountId } = await scheduleOnFreshAccount({
        payee: 'Stranded',
        amountCents: 700,
        nextDate: '2026-08-01',
      });
      await request(app.getHttpServer())
        .patch(`/api/accounts/${accountId}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ isArchived: true })
        .expect(200);

      const summary = await recurringService.materializeDue(NOW);

      expect(summary.skipped).toBeGreaterThanOrEqual(1);
      expect(await ledgerFor(id)).toHaveLength(0);
      // Still active and still due, so un-archiving self-heals on the next run.
      const after = await request(app.getHttpServer())
        .get(`/api/recurring/${id}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);
      expect(after.body.isActive).toBe(true);
      expect(after.body.nextDate).toContain('2026-08-01');
    });

    it('does not materialize another household schedules', async () => {
      const before = await request(app.getHttpServer())
        .post('/api/recurring')
        .set('Authorization', `Bearer ${tokenB}`)
        .send({
          accountId: bAccount,
          categoryId: bCategory,
          type: 'expense',
          amountCents: 999,
          payee: 'B bill',
          cadence: 'monthly',
          nextDate: '2026-08-01',
        })
        .expect(201);

      await recurringService.materializeDue(NOW);

      // B's schedule is materialized into B's ledger, never A's.
      const rows = await ledgerFor(before.body._id);
      expect(rows).toHaveLength(1);
      expect(
        (rows[0].householdId as unknown as Types.ObjectId).toString(),
      ).not.toBe(householdIdA);
    });
  });
});
