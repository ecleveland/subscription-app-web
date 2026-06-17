import { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { createTestApp, closeTestApp } from './helpers/test-app';
import { HouseholdsService } from '../src/households/households.service';
import { Category } from '../src/categories/schemas/category.schema';

/** Decode the `sub` (userId) claim from a JWT access token. */
function userIdFromToken(token: string): string {
  const payload = JSON.parse(
    Buffer.from(token.split('.')[1], 'base64').toString('utf8'),
  ) as { sub: string };
  return payload.sub;
}

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

async function getBalance(
  app: INestApplication<App>,
  token: string,
  accountId: string,
): Promise<number> {
  const res = await request(app.getHttpServer())
    .get(`/api/accounts/${accountId}`)
    .set('Authorization', `Bearer ${token}`)
    .expect(200);
  return res.body.balanceCents;
}

describe('Transactions (e2e)', () => {
  let app: INestApplication<App>;
  let tokenA: string;
  let tokenB: string;
  let categoryModel: Model<Category>;

  // Household A fixtures.
  let householdIdA: string;
  let expenseCatA: string;
  let incomeCatA: string;
  let checkingA: string;
  let savingsA: string;
  const CHECKING_OPENING = 100000;

  // Household B fixtures (for cross-household isolation).
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

  beforeAll(async () => {
    app = await createTestApp();
    categoryModel = app.get<Model<Category>>(getModelToken(Category.name));
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
    expenseCatA = await seededCategory(householdIdA, false);
    incomeCatA = await seededCategory(householdIdA, true);

    checkingA = await createAccount(app, tokenA, {
      name: 'Checking',
      type: 'checking',
      balanceCents: CHECKING_OPENING,
    });
    savingsA = await createAccount(app, tokenA, {
      name: 'Savings',
      type: 'savings',
    });

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

  describe('balance effects through the ledger', () => {
    let expenseId: string;

    it('an expense decreases the account balance', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/transactions')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          accountId: checkingA,
          type: 'expense',
          amountCents: 4200,
          date: '2026-06-10',
          categoryId: expenseCatA,
          payee: 'Groceries',
        })
        .expect(201);
      expenseId = res.body._id;

      expect(await getBalance(app, tokenA, checkingA)).toBe(
        CHECKING_OPENING - 4200,
      );
    });

    it('income increases the account balance', async () => {
      await request(app.getHttpServer())
        .post('/api/transactions')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          accountId: checkingA,
          type: 'income',
          amountCents: 5000,
          date: '2026-06-11',
          categoryId: incomeCatA,
        })
        .expect(201);

      expect(await getBalance(app, tokenA, checkingA)).toBe(
        CHECKING_OPENING - 4200 + 5000,
      );
    });

    it('a transfer moves money between two accounts', async () => {
      await request(app.getHttpServer())
        .post('/api/transactions')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          accountId: checkingA,
          type: 'transfer',
          amountCents: 10000,
          date: '2026-06-12',
          transferAccountId: savingsA,
        })
        .expect(201);

      expect(await getBalance(app, tokenA, checkingA)).toBe(
        CHECKING_OPENING - 4200 + 5000 - 10000,
      );
      expect(await getBalance(app, tokenA, savingsA)).toBe(10000);
    });

    it('updating the amount re-points the balance by the delta', async () => {
      await request(app.getHttpServer())
        .patch(`/api/transactions/${expenseId}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ amountCents: 6200 })
        .expect(200);

      // expense grew by 2000, so checking drops a further 2000
      expect(await getBalance(app, tokenA, checkingA)).toBe(
        CHECKING_OPENING - 6200 + 5000 - 10000,
      );
    });

    it('deleting a transaction reverses its balance effect', async () => {
      await request(app.getHttpServer())
        .delete(`/api/transactions/${expenseId}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(204);

      expect(await getBalance(app, tokenA, checkingA)).toBe(
        CHECKING_OPENING + 5000 - 10000,
      );
      await request(app.getHttpServer())
        .get(`/api/transactions/${expenseId}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(404);
    });
  });

  describe('list & filters', () => {
    it('lists the household transactions (paginated) and filters by type', async () => {
      const all = await request(app.getHttpServer())
        .get('/api/transactions')
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);
      expect(all.body.meta.total).toBeGreaterThanOrEqual(2);
      expect(Array.isArray(all.body.data)).toBe(true);

      const transfers = await request(app.getHttpServer())
        .get('/api/transactions?type=transfer')
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);
      expect(
        transfers.body.data.every(
          (t: { type: string }) => t.type === 'transfer',
        ),
      ).toBe(true);
    });
  });

  describe('validation', () => {
    const post = (body: Record<string, unknown>) =>
      request(app.getHttpServer())
        .post('/api/transactions')
        .set('Authorization', `Bearer ${tokenA}`)
        .send(body);

    it('rejects an expense without a category', async () => {
      await post({
        accountId: checkingA,
        type: 'expense',
        amountCents: 100,
        date: '2026-06-13',
      }).expect(400);
    });

    it('rejects a transfer without a destination', async () => {
      await post({
        accountId: checkingA,
        type: 'transfer',
        amountCents: 100,
        date: '2026-06-13',
      }).expect(400);
    });

    it('rejects a transfer to the same account', async () => {
      await post({
        accountId: checkingA,
        type: 'transfer',
        amountCents: 100,
        date: '2026-06-13',
        transferAccountId: checkingA,
      }).expect(400);
    });

    it('rejects a non-integer amount', async () => {
      await post({
        accountId: checkingA,
        type: 'expense',
        amountCents: 1.5,
        date: '2026-06-13',
        categoryId: expenseCatA,
      }).expect(400);
    });

    it('rejects a zero amount', async () => {
      await post({
        accountId: checkingA,
        type: 'expense',
        amountCents: 0,
        date: '2026-06-13',
        categoryId: expenseCatA,
      }).expect(400);
    });

    it('rejects unknown fields', async () => {
      await post({
        accountId: checkingA,
        type: 'expense',
        amountCents: 100,
        date: '2026-06-13',
        categoryId: expenseCatA,
        hacker: true,
      }).expect(400);
    });
  });

  describe('cross-household isolation', () => {
    let aTxnId: string;

    beforeAll(async () => {
      const res = await request(app.getHttpServer())
        .post('/api/transactions')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          accountId: checkingA,
          type: 'expense',
          amountCents: 100,
          date: '2026-06-14',
          categoryId: expenseCatA,
        })
        .expect(201);
      aTxnId = res.body._id;
    });

    it("rejects referencing another household's account (400)", async () => {
      await request(app.getHttpServer())
        .post('/api/transactions')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          accountId: bAccount,
          type: 'expense',
          amountCents: 100,
          date: '2026-06-14',
          categoryId: expenseCatA,
        })
        .expect(400);
    });

    it("rejects referencing another household's category (400)", async () => {
      await request(app.getHttpServer())
        .post('/api/transactions')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          accountId: checkingA,
          type: 'expense',
          amountCents: 100,
          date: '2026-06-14',
          categoryId: bCategory,
        })
        .expect(400);
    });

    it("does not surface another household's transaction (404 read/update/delete)", async () => {
      await request(app.getHttpServer())
        .get(`/api/transactions/${aTxnId}`)
        .set('Authorization', `Bearer ${tokenB}`)
        .expect(404);
      await request(app.getHttpServer())
        .patch(`/api/transactions/${aTxnId}`)
        .set('Authorization', `Bearer ${tokenB}`)
        .send({ amountCents: 999 })
        .expect(404);
      await request(app.getHttpServer())
        .delete(`/api/transactions/${aTxnId}`)
        .set('Authorization', `Bearer ${tokenB}`)
        .expect(404);
    });

    it("B's transaction list never includes A's transactions", async () => {
      const res = await request(app.getHttpServer())
        .get('/api/transactions')
        .set('Authorization', `Bearer ${tokenB}`)
        .expect(200);
      expect(
        res.body.data.every((t: { _id: string }) => t._id !== aTxnId),
      ).toBe(true);
    });
  });

  describe('auth', () => {
    it('returns 401 without a token', async () => {
      await request(app.getHttpServer()).get('/api/transactions').expect(401);
    });
  });
});
