import { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { createTestApp, closeTestApp } from './helpers/test-app';
import { HouseholdsService } from '../src/households/households.service';
import { Category } from '../src/categories/schemas/category.schema';
import { Budget } from '../src/budgets/schemas/budget.schema';

function userIdFromToken(token: string): string {
  const payload = JSON.parse(
    Buffer.from(token.split('.')[1], 'base64').toString('utf8'),
  ) as { sub: string };
  return payload.sub;
}

describe('Budgets (e2e)', () => {
  let app: INestApplication<App>;
  let tokenA: string;
  let tokenB: string;
  let categoryModel: Model<Category>;
  let budgetModel: Model<Budget>;

  // Household A fixtures.
  let expenseCatA: string;
  let expenseCat2A: string;
  let incomeCatA: string;
  let checkingA: string;
  let savingsA: string;

  // Household B fixtures (cross-household isolation).
  let expenseCatB: string;
  let checkingB: string;

  async function expenseCategories(householdId: string): Promise<string[]> {
    const cats = await categoryModel
      .find({ householdId, isIncome: false } as Record<string, unknown>)
      .limit(2)
      .exec();
    return cats.map((c) => (c._id as { toString(): string }).toString());
  }

  async function incomeCategory(householdId: string): Promise<string> {
    const cat = await categoryModel
      .findOne({ householdId, isIncome: true } as Record<string, unknown>)
      .exec();
    return (cat!._id as { toString(): string }).toString();
  }

  async function createAccount(
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

  async function createTxn(
    token: string,
    body: Record<string, unknown>,
  ): Promise<void> {
    await request(app.getHttpServer())
      .post('/api/transactions')
      .set('Authorization', `Bearer ${token}`)
      .send(body)
      .expect(201);
  }

  function getBudget(token: string, month: string) {
    return request(app.getHttpServer())
      .get(`/api/budgets/${month}`)
      .set('Authorization', `Bearer ${token}`);
  }

  beforeAll(async () => {
    app = await createTestApp();
    categoryModel = app.get<Model<Category>>(getModelToken(Category.name));
    budgetModel = app.get<Model<Budget>>(getModelToken(Budget.name));
    const households = app.get(HouseholdsService);

    const resA = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ username: 'budgeta', password: 'Password123' });
    tokenA = resA.body.access_token;
    const resB = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ username: 'budgetb', password: 'Password123' });
    tokenB = resB.body.access_token;

    const membershipA = await households.findMembershipByUser(
      userIdFromToken(tokenA),
    );
    const householdIdA = (
      membershipA!.householdId as { toString(): string }
    ).toString();
    [expenseCatA, expenseCat2A] = await expenseCategories(householdIdA);
    incomeCatA = await incomeCategory(householdIdA);
    checkingA = await createAccount(tokenA, {
      name: 'Checking',
      type: 'checking',
      balanceCents: 1000000,
    });
    savingsA = await createAccount(tokenA, {
      name: 'Savings',
      type: 'savings',
    });

    const membershipB = await households.findMembershipByUser(
      userIdFromToken(tokenB),
    );
    const householdIdB = (
      membershipB!.householdId as { toString(): string }
    ).toString();
    [expenseCatB] = await expenseCategories(householdIdB);
    checkingB = await createAccount(tokenB, {
      name: 'B Checking',
      type: 'checking',
      balanceCents: 1000000,
    });
  });

  afterAll(async () => {
    await closeTestApp(app);
  });

  describe('auth & validation', () => {
    it('requires authentication', async () => {
      await request(app.getHttpServer())
        .get('/api/budgets/2026-06')
        .expect(401);
    });

    it.each(['2026-13', '2026-1', '2026-00', 'nope'])(
      'rejects malformed month %s with 400',
      async (month) => {
        await getBudget(tokenA, month).expect(400);
      },
    );

    it('rejects a non-ObjectId categoryId on PUT', async () => {
      await request(app.getHttpServer())
        .put('/api/budgets/2026-06/categories/not-an-id')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ plannedCents: 1000 })
        .expect(400);
    });

    it.each([
      { plannedCents: -1 },
      { plannedCents: 1.5 },
      { plannedCents: 'x' },
    ])('rejects an invalid plannedCents %o', async (body) => {
      await request(app.getHttpServer())
        .put(`/api/budgets/2026-06/categories/${expenseCatA}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send(body)
        .expect(400);
    });

    it('accepts plannedCents 0 as a deliberate limit', async () => {
      await request(app.getHttpServer())
        .put(`/api/budgets/2026-01/categories/${expenseCatA}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ plannedCents: 0 })
        .expect(200);
    });
  });

  describe('virtual GET (read-only)', () => {
    const MONTH = '2099-01';

    it('returns an empty budget without creating a document', async () => {
      const res = await getBudget(tokenA, MONTH).expect(200);
      expect(res.body).toEqual({
        month: MONTH,
        categories: [],
        totalPlannedCents: 0,
        totalActualCents: 0,
        incomeCents: 0,
        toBeBudgetedCents: 0,
      });
      expect(await budgetModel.countDocuments({ month: MONTH })).toBe(0);
    });

    it('creates the budget document only on the first write', async () => {
      await request(app.getHttpServer())
        .put(`/api/budgets/${MONTH}/categories/${expenseCatA}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ plannedCents: 12345 })
        .expect(200);
      expect(await budgetModel.countDocuments({ month: MONTH })).toBe(1);
    });
  });

  describe('set & read a planned limit', () => {
    const MONTH = '2026-03';

    it('PUT sets the limit and GET reflects it', async () => {
      await request(app.getHttpServer())
        .put(`/api/budgets/${MONTH}/categories/${expenseCatA}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ plannedCents: 50000 })
        .expect(200);

      const res = await getBudget(tokenA, MONTH).expect(200);
      expect(res.body.categories).toContainEqual({
        categoryId: expenseCatA,
        plannedCents: 50000,
        actualCents: 0,
        remainingCents: 50000,
        isIncome: false,
      });
      expect(res.body.totalPlannedCents).toBe(50000);
      // No income this month, so 50000 is planned beyond income → negative.
      expect(res.body.toBeBudgetedCents).toBe(-50000);
    });

    it('re-PUT updates the limit (upsert)', async () => {
      await request(app.getHttpServer())
        .put(`/api/budgets/${MONTH}/categories/${expenseCatA}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ plannedCents: 75000 })
        .expect(200);
      const res = await getBudget(tokenA, MONTH).expect(200);
      const row = res.body.categories.find(
        (c: { categoryId: string }) => c.categoryId === expenseCatA,
      );
      expect(row.plannedCents).toBe(75000);
    });

    it('rejects a category from another household', async () => {
      await request(app.getHttpServer())
        .put(`/api/budgets/${MONTH}/categories/${expenseCatB}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ plannedCents: 1000 })
        .expect(400);
    });
  });

  describe('budget-vs-actual aggregation', () => {
    const MONTH = '2026-04';

    beforeAll(async () => {
      await request(app.getHttpServer())
        .put(`/api/budgets/${MONTH}/categories/${expenseCatA}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ plannedCents: 50000 })
        .expect(200);
      // Two expenses in the budgeted category (sum 80000 → overspend).
      await createTxn(tokenA, {
        accountId: checkingA,
        type: 'expense',
        amountCents: 45000,
        date: '2026-04-10',
        categoryId: expenseCatA,
      });
      await createTxn(tokenA, {
        accountId: checkingA,
        type: 'expense',
        amountCents: 35000,
        date: '2026-04-15',
        categoryId: expenseCatA,
      });
      // Income.
      await createTxn(tokenA, {
        accountId: checkingA,
        type: 'income',
        amountCents: 310000,
        date: '2026-04-05',
        categoryId: incomeCatA,
      });
      // Spend in an un-budgeted category.
      await createTxn(tokenA, {
        accountId: checkingA,
        type: 'expense',
        amountCents: 6000,
        date: '2026-04-20',
        categoryId: expenseCat2A,
      });
      // Transfer (excluded from the budget).
      await createTxn(tokenA, {
        accountId: checkingA,
        type: 'transfer',
        amountCents: 10000,
        date: '2026-04-25',
        transferAccountId: savingsA,
      });
    });

    it('aggregates actuals, routes income vs expense, and derives rollups', async () => {
      const res = await getBudget(tokenA, MONTH).expect(200);
      const rows: Record<string, any> = {};
      for (const c of res.body.categories) rows[c.categoryId] = c;

      // Budgeted-and-overspent expense category.
      expect(rows[expenseCatA]).toEqual({
        categoryId: expenseCatA,
        plannedCents: 50000,
        actualCents: 80000,
        remainingCents: -30000,
        isIncome: false,
      });
      // Spend but no limit → appears with plannedCents 0.
      expect(rows[expenseCat2A]).toMatchObject({
        plannedCents: 0,
        actualCents: 6000,
        remainingCents: -6000,
      });
      // Income category routes income, not expense.
      expect(rows[incomeCatA]).toMatchObject({
        actualCents: 310000,
        isIncome: true,
      });

      // Rollups are expense-only; income is its own figure; transfer excluded.
      expect(res.body.totalPlannedCents).toBe(50000);
      expect(res.body.totalActualCents).toBe(86000);
      expect(res.body.incomeCents).toBe(310000);
      expect(res.body.toBeBudgetedCents).toBe(310000 - 50000);
    });
  });

  describe('month boundaries (UTC, half-open range)', () => {
    const MONTH = '2026-05';

    beforeAll(async () => {
      // Last instant of May — included.
      await createTxn(tokenA, {
        accountId: checkingA,
        type: 'expense',
        amountCents: 1000,
        date: '2026-05-31T23:59:59.999Z',
        categoryId: expenseCatA,
      });
      // First instant of June — excluded from May.
      await createTxn(tokenA, {
        accountId: checkingA,
        type: 'expense',
        amountCents: 2000,
        date: '2026-06-01T00:00:00.000Z',
        categoryId: expenseCatA,
      });
    });

    it('includes the last instant of the month and excludes the next month', async () => {
      const res = await getBudget(tokenA, MONTH).expect(200);
      const row = res.body.categories.find(
        (c: { categoryId: string }) => c.categoryId === expenseCatA,
      );
      expect(row.actualCents).toBe(1000);
    });
  });

  describe('DELETE a planned limit', () => {
    const MONTH = '2026-08';

    it('removes the row; an un-spent category then disappears from the view', async () => {
      await request(app.getHttpServer())
        .put(`/api/budgets/${MONTH}/categories/${expenseCatA}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ plannedCents: 50000 })
        .expect(200);
      await request(app.getHttpServer())
        .delete(`/api/budgets/${MONTH}/categories/${expenseCatA}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(204);

      const res = await getBudget(tokenA, MONTH).expect(200);
      expect(res.body.categories).toEqual([]);
    });

    it('is idempotent (deleting a missing row / missing budget → 204)', async () => {
      await request(app.getHttpServer())
        .delete(`/api/budgets/${MONTH}/categories/${expenseCatA}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(204);
      await request(app.getHttpServer())
        .delete(`/api/budgets/2031-01/categories/${expenseCatA}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(204);
    });
  });

  describe('bulk set', () => {
    it('upserts several limits in one call and returns the recomputed view', async () => {
      const res = await request(app.getHttpServer())
        .put('/api/budgets/2026-09')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          categories: [
            { categoryId: expenseCatA, plannedCents: 30000 },
            { categoryId: expenseCat2A, plannedCents: 20000 },
          ],
        })
        .expect(200);
      expect(res.body.totalPlannedCents).toBe(50000);
      const ids = res.body.categories.map(
        (c: { categoryId: string }) => c.categoryId,
      );
      expect(ids).toEqual(expect.arrayContaining([expenseCatA, expenseCat2A]));
    });

    it('rejects the whole batch and writes nothing if any category is foreign', async () => {
      await request(app.getHttpServer())
        .put('/api/budgets/2026-10')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          categories: [
            { categoryId: expenseCatA, plannedCents: 1000 },
            { categoryId: expenseCatB, plannedCents: 2000 },
          ],
        })
        .expect(400);
      // No partial write: the month has no budget rows.
      const res = await getBudget(tokenA, '2026-10').expect(200);
      expect(res.body.categories).toEqual([]);
    });

    it('rejects invalid item payloads', async () => {
      await request(app.getHttpServer())
        .put('/api/budgets/2026-10')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ categories: [{ categoryId: expenseCatA, plannedCents: -5 }] })
        .expect(400);
      await request(app.getHttpServer())
        .put('/api/budgets/2026-10')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ categories: [{ categoryId: 'not-an-id', plannedCents: 5 }] })
        .expect(400);
    });
  });

  describe('cross-household isolation', () => {
    const MONTH = '2026-11';

    beforeAll(async () => {
      await request(app.getHttpServer())
        .put(`/api/budgets/${MONTH}/categories/${expenseCatA}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ plannedCents: 50000 })
        .expect(200);
      await createTxn(tokenA, {
        accountId: checkingA,
        type: 'expense',
        amountCents: 12345,
        date: '2026-11-10',
        categoryId: expenseCatA,
      });
      // B spends in its own household, same month.
      await createTxn(tokenB, {
        accountId: checkingB,
        type: 'expense',
        amountCents: 99999,
        date: '2026-11-10',
        categoryId: expenseCatB,
      });
    });

    it("B's budget never reflects A's planned limits or actuals", async () => {
      const res = await getBudget(tokenB, MONTH).expect(200);
      const aRow = res.body.categories.find(
        (c: { categoryId: string }) => c.categoryId === expenseCatA,
      );
      expect(aRow).toBeUndefined();
      expect(res.body.totalPlannedCents).toBe(0);
    });

    it("A's actuals are unaffected by B's transactions", async () => {
      const res = await getBudget(tokenA, MONTH).expect(200);
      const row = res.body.categories.find(
        (c: { categoryId: string }) => c.categoryId === expenseCatA,
      );
      expect(row.actualCents).toBe(12345);
    });

    it('B cannot set a limit on A’s category (single or bulk)', async () => {
      await request(app.getHttpServer())
        .put(`/api/budgets/${MONTH}/categories/${expenseCatA}`)
        .set('Authorization', `Bearer ${tokenB}`)
        .send({ plannedCents: 1 })
        .expect(400);
      await request(app.getHttpServer())
        .put(`/api/budgets/${MONTH}`)
        .set('Authorization', `Bearer ${tokenB}`)
        .send({ categories: [{ categoryId: expenseCatA, plannedCents: 1 }] })
        .expect(400);
    });
  });
});
