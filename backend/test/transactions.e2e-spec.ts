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

  describe('credit account negatives', () => {
    it('drives a credit account negative and tracks cumulative cents', async () => {
      const creditId = await createAccount(app, tokenA, {
        name: 'Visa',
        type: 'credit',
      });

      await request(app.getHttpServer())
        .post('/api/transactions')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          accountId: creditId,
          type: 'expense',
          amountCents: 5000,
          date: '2026-06-15',
          categoryId: expenseCatA,
        })
        .expect(201);
      expect(await getBalance(app, tokenA, creditId)).toBe(-5000);

      await request(app.getHttpServer())
        .post('/api/transactions')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          accountId: creditId,
          type: 'expense',
          amountCents: 7000,
          date: '2026-06-16',
          categoryId: expenseCatA,
        })
        .expect(201);
      expect(await getBalance(app, tokenA, creditId)).toBe(-12000);
    });
  });

  describe('transfer mutation re-points both balances', () => {
    let srcId: string;
    let dstId: string;
    let altDstId: string;
    let transferId: string;

    it('PATCHing a transfer amount moves the new amount across both accounts', async () => {
      srcId = await createAccount(app, tokenA, {
        name: 'Src',
        type: 'checking',
        balanceCents: 50000,
      });
      dstId = await createAccount(app, tokenA, {
        name: 'Dst',
        type: 'savings',
      });
      altDstId = await createAccount(app, tokenA, {
        name: 'Alt',
        type: 'savings',
      });

      const res = await request(app.getHttpServer())
        .post('/api/transactions')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          accountId: srcId,
          type: 'transfer',
          amountCents: 10000,
          date: '2026-06-17',
          transferAccountId: dstId,
        })
        .expect(201);
      transferId = res.body._id;
      expect(await getBalance(app, tokenA, srcId)).toBe(40000);
      expect(await getBalance(app, tokenA, dstId)).toBe(10000);

      await request(app.getHttpServer())
        .patch(`/api/transactions/${transferId}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ amountCents: 15000 })
        .expect(200);
      expect(await getBalance(app, tokenA, srcId)).toBe(35000);
      expect(await getBalance(app, tokenA, dstId)).toBe(15000);
    });

    it('PATCHing the destination leg restores the old account and credits the new one', async () => {
      await request(app.getHttpServer())
        .patch(`/api/transactions/${transferId}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ transferAccountId: altDstId })
        .expect(200);

      // src unchanged (still −15000), old dst fully restored, new dst credited
      expect(await getBalance(app, tokenA, srcId)).toBe(35000);
      expect(await getBalance(app, tokenA, dstId)).toBe(0);
      expect(await getBalance(app, tokenA, altDstId)).toBe(15000);
    });

    it('PATCHing accountId moves the source effect to a different account', async () => {
      const otherSrc = await createAccount(app, tokenA, {
        name: 'OtherSrc',
        type: 'checking',
        balanceCents: 20000,
      });

      await request(app.getHttpServer())
        .patch(`/api/transactions/${transferId}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ accountId: otherSrc })
        .expect(200);

      // original src restored to 50000; new src debited 15000
      expect(await getBalance(app, tokenA, srcId)).toBe(50000);
      expect(await getBalance(app, tokenA, otherSrc)).toBe(5000);
      expect(await getBalance(app, tokenA, altDstId)).toBe(15000);
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

    it('filters by a date range', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/transactions?dateFrom=2026-06-11&dateTo=2026-06-12')
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);

      expect(res.body.data.length).toBeGreaterThan(0);
      for (const t of res.body.data as { date: string }[]) {
        const d = t.date.slice(0, 10);
        expect(d >= '2026-06-11' && d <= '2026-06-12').toBe(true);
      }
    });

    it('filters by cleared=false without treating the string as truthy', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/transactions?cleared=false')
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);

      expect(
        res.body.data.every((t: { cleared: boolean }) => t.cleared === false),
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

  describe('CSV import', () => {
    let importAcct: string;
    const mapping = {
      date: 'Date',
      amount: 'Amount',
      payee: 'Payee',
      category: 'Category',
    };
    const rows = [
      {
        Date: '2026-05-01',
        Amount: '-42.00',
        Payee: 'Store',
        Category: 'Groceries',
      },
      { Date: '2026-05-02', Amount: '$1,000.00', Payee: 'Job', Category: '' },
    ];

    beforeAll(async () => {
      importAcct = await createAccount(app, tokenA, {
        name: 'Import Target',
        type: 'checking',
      });
    });

    it('imports parsed rows and adjusts the balance once', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/transactions/import')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ accountId: importAcct, mapping, rows })
        .expect(201);

      expect(res.body).toMatchObject({ imported: 2, skipped: 0 });
      expect(res.body.errors).toEqual([]);
      // -4200 (expense) + 100000 (income) = 95800
      expect(await getBalance(app, tokenA, importAcct)).toBe(95800);
    });

    it('is idempotent: re-importing the same rows skips them', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/transactions/import')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ accountId: importAcct, mapping, rows })
        .expect(201);

      expect(res.body).toMatchObject({ imported: 0, skipped: 2 });
      expect(await getBalance(app, tokenA, importAcct)).toBe(95800);
    });

    it('reports a row-level error for an unparseable amount', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/transactions/import')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          accountId: importAcct,
          mapping,
          rows: [
            { Date: '2026-05-03', Amount: 'NaN', Payee: 'X', Category: '' },
          ],
        })
        .expect(201);

      expect(res.body.imported).toBe(0);
      expect(res.body.errors).toEqual([
        { row: 0, message: 'Unparseable amount' },
      ]);
    });

    it("rejects importing into another household's account (400)", async () => {
      await request(app.getHttpServer())
        .post('/api/transactions/import')
        .set('Authorization', `Bearer ${tokenB}`)
        .send({ accountId: importAcct, mapping, rows })
        .expect(400);
    });

    it('rejects importing into an archived account (400)', async () => {
      const archived = await createAccount(app, tokenA, {
        name: 'Closed',
        type: 'checking',
      });
      await request(app.getHttpServer())
        .delete(`/api/accounts/${archived}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(204);

      await request(app.getHttpServer())
        .post('/api/transactions/import')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ accountId: archived, mapping, rows })
        .expect(400);
    });
  });

  describe('editing fields', () => {
    it('clears a payee when an empty string is sent', async () => {
      const created = await request(app.getHttpServer())
        .post('/api/transactions')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          accountId: checkingA,
          type: 'expense',
          amountCents: 100,
          date: '2026-05-20',
          categoryId: expenseCatA,
          payee: 'Original',
        })
        .expect(201);
      expect(created.body.payee).toBe('Original');

      const updated = await request(app.getHttpServer())
        .patch(`/api/transactions/${created.body._id}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ payee: '' })
        .expect(200);
      expect(updated.body.payee ?? '').toBe('');
    });
  });

  describe('auth', () => {
    it('returns 401 without a token', async () => {
      await request(app.getHttpServer()).get('/api/transactions').expect(401);
    });
  });
});
