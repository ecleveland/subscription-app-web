import { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { createTestApp, closeTestApp } from './helpers/test-app';
import { userIdFromToken } from './helpers/jwt';
import { HouseholdsService } from '../src/households/households.service';
import { Category } from '../src/categories/schemas/category.schema';
import { CategoryGroup } from '../src/categories/schemas/category-group.schema';

describe('Reports (e2e)', () => {
  let app: INestApplication<App>;
  let categoryModel: Model<Category>;
  let households: HouseholdsService;
  let tokenA: string;
  let tokenB: string;

  async function register(username: string): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ username, password: 'Password123' })
      .expect(201);
    return res.body.access_token;
  }

  async function categoryFor(
    token: string,
    isIncome: boolean,
  ): Promise<string> {
    const membership = await households.findMembershipByUser(
      userIdFromToken(token),
    );
    const cat = await categoryModel
      .findOne({
        householdId: membership!.householdId,
        isIncome,
      } as Record<string, unknown>)
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

  function cashFlow(token: string, query: Record<string, string>) {
    return request(app.getHttpServer())
      .get('/api/reports/cash-flow')
      .query(query)
      .set('Authorization', `Bearer ${token}`);
  }

  beforeAll(async () => {
    app = await createTestApp();
    categoryModel = app.get<Model<Category>>(getModelToken(Category.name));
    households = app.get(HouseholdsService);

    tokenA = await register('reportsa');
    tokenB = await register('reportsb');

    const incomeA = await categoryFor(tokenA, true);
    const expenseA = await categoryFor(tokenA, false);
    const checkingA = await createAccount(tokenA, {
      name: 'Checking',
      type: 'checking',
      balanceCents: 1000000,
    });
    const savingsA = await createAccount(tokenA, {
      name: 'Savings',
      type: 'savings',
    });
    const cardA = await createAccount(tokenA, {
      name: 'Card',
      type: 'credit',
    });

    // Household A. January: income and a checking expense. February: nothing.
    // March: a credit card expense on the last second of the month and a
    // transfer. April: an expense on the first second of the month.
    await createTxn(tokenA, {
      accountId: checkingA,
      type: 'income',
      amountCents: 500000,
      date: '2026-01-05',
      categoryId: incomeA,
    });
    await createTxn(tokenA, {
      accountId: checkingA,
      type: 'expense',
      amountCents: 120000,
      date: '2026-01-20',
      categoryId: expenseA,
    });
    await createTxn(tokenA, {
      accountId: cardA,
      type: 'expense',
      amountCents: 4500,
      date: '2026-03-31T23:59:59Z',
      categoryId: expenseA,
    });
    await createTxn(tokenA, {
      accountId: checkingA,
      type: 'transfer',
      amountCents: 70000,
      date: '2026-03-15',
      transferAccountId: savingsA,
    });
    await createTxn(tokenA, {
      accountId: checkingA,
      type: 'expense',
      amountCents: 2500,
      date: '2026-04-01T00:00:00Z',
      categoryId: expenseA,
    });

    // Household B overlaps January and March with different amounts.
    const incomeB = await categoryFor(tokenB, true);
    const expenseB = await categoryFor(tokenB, false);
    const checkingB = await createAccount(tokenB, {
      name: 'B Checking',
      type: 'checking',
      balanceCents: 1000000,
    });
    await createTxn(tokenB, {
      accountId: checkingB,
      type: 'income',
      amountCents: 9000,
      date: '2026-01-10',
      categoryId: incomeB,
    });
    await createTxn(tokenB, {
      accountId: checkingB,
      type: 'expense',
      amountCents: 3000,
      date: '2026-03-10',
      categoryId: expenseB,
    });
  });

  afterAll(async () => {
    await closeTestApp(app);
  });

  it('requires authentication', async () => {
    await request(app.getHttpServer())
      .get('/api/reports/cash-flow?from=2026-01&to=2026-04')
      .expect(401);
  });

  it("returns household A's months, zero-filled, with transfers left out", async () => {
    const res = await cashFlow(tokenA, {
      from: '2026-01',
      to: '2026-04',
    }).expect(200);
    expect(res.body).toEqual({
      months: [
        {
          month: '2026-01',
          incomeCents: 500000,
          expenseCents: 120000,
          netCents: 380000,
        },
        { month: '2026-02', incomeCents: 0, expenseCents: 0, netCents: 0 },
        // Only the credit card expense; the 70000 transfer does not appear.
        {
          month: '2026-03',
          incomeCents: 0,
          expenseCents: 4500,
          netCents: -4500,
        },
        {
          month: '2026-04',
          incomeCents: 0,
          expenseCents: 2500,
          netCents: -2500,
        },
      ],
    });
  });

  it("returns only household B's totals for the overlapping months", async () => {
    const res = await cashFlow(tokenB, {
      from: '2026-01',
      to: '2026-04',
    }).expect(200);
    expect(res.body).toEqual({
      months: [
        {
          month: '2026-01',
          incomeCents: 9000,
          expenseCents: 0,
          netCents: 9000,
        },
        { month: '2026-02', incomeCents: 0, expenseCents: 0, netCents: 0 },
        {
          month: '2026-03',
          incomeCents: 0,
          expenseCents: 3000,
          netCents: -3000,
        },
        { month: '2026-04', incomeCents: 0, expenseCents: 0, netCents: 0 },
      ],
    });
  });

  it('keeps the month boundary at UTC midnight', async () => {
    const march = await cashFlow(tokenA, {
      from: '2026-03',
      to: '2026-03',
    }).expect(200);
    expect(march.body.months).toEqual([
      { month: '2026-03', incomeCents: 0, expenseCents: 4500, netCents: -4500 },
    ]);
    const april = await cashFlow(tokenA, {
      from: '2026-04',
      to: '2026-04',
    }).expect(200);
    expect(april.body.months).toEqual([
      { month: '2026-04', incomeCents: 0, expenseCents: 2500, netCents: -2500 },
    ]);
  });

  it('accepts exactly 36 months', async () => {
    const res = await cashFlow(tokenA, {
      from: '2024-01',
      to: '2026-12',
    }).expect(200);
    expect(res.body.months).toHaveLength(36);
    expect(res.body.months[0].month).toBe('2024-01');
    expect(res.body.months[35].month).toBe('2026-12');
  });

  describe('validation', () => {
    it.each([
      ['a malformed from', { from: '2026-13', to: '2026-04' }],
      ['a malformed to', { from: '2026-01', to: '2026-4' }],
      ['a full date', { from: '2026-01-01', to: '2026-04' }],
      ['a missing from', { to: '2026-04' }],
      ['a missing to', { from: '2026-01' }],
      ['from after to', { from: '2026-05', to: '2026-04' }],
      ['37 months', { from: '2024-01', to: '2027-01' }],
    ])('rejects %s with 400', async (_label, query) => {
      await cashFlow(tokenA, query as Record<string, string>).expect(400);
    });

    it('rejects an unknown query param with 400', async () => {
      await cashFlow(tokenA, {
        from: '2026-01',
        to: '2026-04',
        extra: 'x',
      }).expect(400);
    });
  });

  describe('GET /reports/spending', () => {
    let expenseA: string;
    let expenseB: string;
    let incomeA: string;
    let groupNameA: string;
    let checkingA: string;

    function spending(token: string, query: Record<string, string>) {
      return request(app.getHttpServer())
        .get('/api/reports/spending')
        .query(query)
        .set('Authorization', `Bearer ${token}`);
    }

    beforeAll(async () => {
      incomeA = await categoryFor(tokenA, true);
      expenseA = await categoryFor(tokenA, false);
      expenseB = await categoryFor(tokenB, false);
      const groupModel = app.get<Model<CategoryGroup>>(
        getModelToken(CategoryGroup.name),
      );
      const category = await categoryModel.findById(expenseA).exec();
      const group = await groupModel.findById(category!.groupId).exec();
      groupNameA = group!.name;

      checkingA = await createAccount(tokenA, {
        name: 'Spending Checking',
        type: 'checking',
        balanceCents: 1000000,
      });
      const checkingB = await createAccount(tokenB, {
        name: 'B Spending Checking',
        type: 'checking',
        balanceCents: 1000000,
      });

      // June: no Budget document for either household. A has an expense and
      // income, B has an expense in the same month.
      await createTxn(tokenA, {
        accountId: checkingA,
        type: 'expense',
        amountCents: 8000,
        date: '2026-06-10',
        categoryId: expenseA,
      });
      await createTxn(tokenA, {
        accountId: checkingA,
        type: 'income',
        amountCents: 300000,
        date: '2026-06-01',
        categoryId: incomeA,
      });
      await createTxn(tokenB, {
        accountId: checkingB,
        type: 'expense',
        amountCents: 1100,
        date: '2026-06-12',
        categoryId: expenseB,
      });
    });

    it('requires authentication', async () => {
      await request(app.getHttpServer())
        .get('/api/reports/spending?month=2026-06')
        .expect(401);
    });

    it("returns household A's expense categories only, with income left out", async () => {
      const res = await spending(tokenA, { month: '2026-06' }).expect(200);
      expect(res.body).toEqual({
        month: '2026-06',
        categories: [
          {
            categoryId: expenseA,
            categoryName: expect.any(String),
            groupId: expect.any(String),
            groupName: groupNameA,
            actualCents: 8000,
            plannedCents: null,
          },
        ],
        uncategorizedCents: 0,
        totalCents: 8000,
      });
    });

    it("returns only household B's spend for the same month", async () => {
      const res = await spending(tokenB, { month: '2026-06' }).expect(200);
      expect(res.body.categories).toHaveLength(1);
      expect(res.body.categories[0]).toMatchObject({
        categoryId: expenseB,
        actualCents: 1100,
        plannedCents: null,
      });
      expect(res.body.totalCents).toBe(1100);
    });

    it('shows the planned amount and the same actual as the budget view', async () => {
      // September belongs to this test alone.
      await createTxn(tokenA, {
        accountId: checkingA,
        type: 'expense',
        amountCents: 2500,
        date: '2026-09-04',
        categoryId: expenseA,
      });
      await request(app.getHttpServer())
        .put(`/api/budgets/2026-09/categories/${expenseA}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ plannedCents: 5000 })
        .expect(200);

      const res = await spending(tokenA, { month: '2026-09' }).expect(200);
      const budget = await request(app.getHttpServer())
        .get('/api/budgets/2026-09')
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);

      const row = res.body.categories.find(
        (c: { categoryId: string }) => c.categoryId === expenseA,
      );
      expect(row).toMatchObject({ actualCents: 2500, plannedCents: 5000 });
      const budgetRow = budget.body.categories.find(
        (c: { categoryId: string }) => c.categoryId === expenseA,
      );
      expect(budgetRow.actualCents).toBe(row.actualCents);
    });

    it('rolls an expense on an income category into uncategorizedCents and keeps the totals reconciled', async () => {
      // October belongs to this test alone. Transactions do not check that an
      // expense's category is an expense category, so this can happen.
      await createTxn(tokenA, {
        accountId: checkingA,
        type: 'expense',
        amountCents: 600,
        date: '2026-10-02',
        categoryId: incomeA,
      });
      await createTxn(tokenA, {
        accountId: checkingA,
        type: 'expense',
        amountCents: 1400,
        date: '2026-10-03',
        categoryId: expenseA,
      });

      const res = await spending(tokenA, { month: '2026-10' }).expect(200);

      expect(res.body.categories).toHaveLength(1);
      expect(res.body.categories[0]).toMatchObject({
        categoryId: expenseA,
        actualCents: 1400,
      });
      expect(res.body.uncategorizedCents).toBe(600);
      expect(res.body.totalCents).toBe(2000);
    });

    it.each([
      ['a malformed month', { month: '2026-13' }],
      ['a missing month', {}],
    ])('rejects %s with 400', async (_label, query) => {
      await spending(tokenA, query as Record<string, string>).expect(400);
    });
  });
});
