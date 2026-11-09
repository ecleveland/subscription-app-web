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
import { Account } from '../src/accounts/schemas/account.schema';

/** Decode the `sub` (userId) claim from a JWT access token. */
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
  let transactionModel: Model<Transaction>;
  let accountModel: Model<Account>;

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
    accountModel = app.get<Model<Account>>(getModelToken(Account.name));
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

    it('filters by cleared, reading the raw string so "false" is not coerced truthy', async () => {
      // Seed one cleared and one uncleared transaction on a fresh account, then
      // scope each query to it so the assertions are exact (not vacuous). The
      // bug this guards (VEG-475): under enableImplicitConversion, "false" was
      // coerced to boolean true, so ?cleared=false returned cleared rows.
      const acct = await createAccount(app, tokenA, {
        name: 'Cleared Filter',
        type: 'checking',
      });
      await request(app.getHttpServer())
        .post('/api/transactions')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          accountId: acct,
          type: 'expense',
          amountCents: 100,
          date: '2026-06-20',
          categoryId: expenseCatA,
          cleared: true,
        })
        .expect(201);
      await request(app.getHttpServer())
        .post('/api/transactions')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          accountId: acct,
          type: 'expense',
          amountCents: 200,
          date: '2026-06-20',
          categoryId: expenseCatA,
          cleared: false,
        })
        .expect(201);

      const uncleared = await request(app.getHttpServer())
        .get(`/api/transactions?accountId=${acct}&cleared=false`)
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);
      expect(uncleared.body.data).toHaveLength(1);
      expect(uncleared.body.data[0].cleared).toBe(false);
      expect(uncleared.body.data[0].amountCents).toBe(200);

      const cleared = await request(app.getHttpServer())
        .get(`/api/transactions?accountId=${acct}&cleared=true`)
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);
      expect(cleared.body.data).toHaveLength(1);
      expect(cleared.body.data[0].cleared).toBe(true);
      expect(cleared.body.data[0].amountCents).toBe(100);
    });

    it('rejects a non-boolean cleared param with 400', async () => {
      await request(app.getHttpServer())
        .get('/api/transactions?cleared=banana')
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(400);
    });

    it('filters by recurringId to a schedule’s materialized transactions', async () => {
      // The HTTP create path strips recurringId (whitelist), so seed the
      // materialized rows directly the way the scheduler does.
      const recurringId = new Types.ObjectId();
      const otherRecurringId = new Types.ObjectId();
      await transactionModel.create([
        {
          householdId: new Types.ObjectId(householdIdA),
          accountId: new Types.ObjectId(checkingA),
          categoryId: new Types.ObjectId(expenseCatA),
          type: 'expense',
          amountCents: 1500,
          date: new Date('2026-06-20'),
          payee: 'Netflix',
          recurringId,
        },
        {
          householdId: new Types.ObjectId(householdIdA),
          accountId: new Types.ObjectId(checkingA),
          categoryId: new Types.ObjectId(expenseCatA),
          type: 'expense',
          amountCents: 900,
          date: new Date('2026-06-21'),
          payee: 'Spotify',
          recurringId: otherRecurringId,
        },
      ]);

      const res = await request(app.getHttpServer())
        .get(`/api/transactions?recurringId=${recurringId.toString()}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);

      expect(res.body.data.length).toBe(1);
      expect(res.body.data[0].payee).toBe('Netflix');
      expect(res.body.data[0].recurringId).toBe(recurringId.toString());
    });

    it('rejects a malformed recurringId filter', async () => {
      await request(app.getHttpServer())
        .get('/api/transactions?recurringId=not-an-id')
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(400);
    });

    it('does not leak another household’s rows via recurringId (scoping ANDs)', async () => {
      const recurringId = new Types.ObjectId();
      await transactionModel.create({
        householdId: new Types.ObjectId(householdIdA),
        accountId: new Types.ObjectId(checkingA),
        categoryId: new Types.ObjectId(expenseCatA),
        type: 'expense',
        amountCents: 1200,
        date: new Date('2026-06-22'),
        payee: 'A-only recurring',
        recurringId,
      });

      // Household B queries A's recurringId — scoping must yield nothing.
      const res = await request(app.getHttpServer())
        .get(`/api/transactions?recurringId=${recurringId.toString()}`)
        .set('Authorization', `Bearer ${tokenB}`)
        .expect(200);
      expect(res.body.data).toHaveLength(0);
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

  describe('malformed :id', () => {
    it('returns 400 (not 500) for a malformed id on GET/PATCH/DELETE', async () => {
      await request(app.getHttpServer())
        .get('/api/transactions/not-an-id')
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(400);
      await request(app.getHttpServer())
        .patch('/api/transactions/not-an-id')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ amountCents: 100 })
        .expect(400);
      await request(app.getHttpServer())
        .delete('/api/transactions/not-an-id')
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(400);
    });
  });

  describe('auth', () => {
    it('returns 401 without a token', async () => {
      await request(app.getHttpServer()).get('/api/transactions').expect(401);
    });
  });

  // VEG-479: if the account is hard-deleted between a write's validation and its
  // balance $inc, applyBalanceDelta throws (ConflictException) instead of
  // dropping the delta and reporting a false success. Two paths reverse an
  // account WITHOUT re-validating it, so hard-deleting the account doc makes the
  // race deterministic — the reversal $inc matches nothing → 409:
  //   - DELETE reverses the deleted transaction's effect on its account;
  //   - PATCH that MOVES the transaction to another account reverses the OLD
  //     account (validateReferences only checks the new one).
  // create, import, and a same-account amount PATCH all re-validate the account
  // first (a missing account 400s before the balance write), so their
  // matchedCount===0 race isn't reproducible over serial HTTP; that propagation
  // is covered at the unit layer in transactions.service.spec.
  describe('balance-apply conflict surfaces as 409 (VEG-479)', () => {
    async function seedTxnThenDeleteAccount(): Promise<string> {
      const acct = await createAccount(app, tokenA, {
        name: 'Vanishing',
        type: 'checking',
      });
      const txnRes = await request(app.getHttpServer())
        .post('/api/transactions')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          accountId: acct,
          type: 'expense',
          amountCents: 500,
          date: '2027-01-01',
          categoryId: expenseCatA,
        })
        .expect(201);
      // Simulate a concurrent hard delete of the account.
      await accountModel
        .deleteOne({ _id: new Types.ObjectId(acct) } as Record<string, unknown>)
        .exec();
      return txnRes.body._id as string;
    }

    it('DELETE returns 409 when the account was removed mid-write', async () => {
      const txnId = await seedTxnThenDeleteAccount();
      await request(app.getHttpServer())
        .delete(`/api/transactions/${txnId}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(409);
    });

    it('PATCH moving the transaction to another account returns 409 when the old account was removed', async () => {
      const txnId = await seedTxnThenDeleteAccount();
      // savingsA is a valid account, so validateReferences passes on the NEW
      // account; the reversal of the deleted OLD account is what 409s.
      await request(app.getHttpServer())
        .patch(`/api/transactions/${txnId}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ accountId: savingsA })
        .expect(409);
    });
  });

  describe('business labels (VEG-697)', () => {
    let labelA: string;
    let labelB: string;
    let labelAccount: string;

    async function createLabel(token: string, name: string): Promise<string> {
      const res = await request(app.getHttpServer())
        .post('/api/labels')
        .set('Authorization', `Bearer ${token}`)
        .send({ name, color: '#336699' })
        .expect(201);
      return res.body._id;
    }

    function postExpense(body: Record<string, unknown>) {
      return request(app.getHttpServer())
        .post('/api/transactions')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          accountId: labelAccount,
          type: 'expense',
          amountCents: 1200,
          date: '2026-09-01',
          categoryId: expenseCatA,
          ...body,
        });
    }

    beforeAll(async () => {
      labelA = await createLabel(tokenA, 'Freelance');
      labelB = await createLabel(tokenB, 'B Business');
      // A dedicated account keeps these rows off the balances other blocks
      // assert on.
      labelAccount = await createAccount(app, tokenA, {
        name: 'Label Checking',
        type: 'checking',
      });
    });

    it('creates a transaction with a label from the same household', async () => {
      const res = await postExpense({ labelId: labelA }).expect(201);
      expect(res.body.labelId).toBe(labelA);
    });

    it('rejects a label from another household with 400', async () => {
      const res = await postExpense({ labelId: labelB }).expect(400);
      expect(res.body.message).toBe(
        'labelId does not reference a label in this household',
      );
    });

    it('rejects a label on a transfer with 400', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/transactions')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          accountId: labelAccount,
          transferAccountId: savingsA,
          type: 'transfer',
          amountCents: 500,
          date: '2026-09-01',
          labelId: labelA,
        })
        .expect(400);
      expect(res.body.message).toBe('A transfer cannot carry a label');
    });

    it('rejects an archived label with 400', async () => {
      const archived = await createLabel(tokenA, 'Closed Shop');
      await request(app.getHttpServer())
        .patch(`/api/labels/${archived}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ isArchived: true })
        .expect(200);

      const res = await postExpense({ labelId: archived }).expect(400);
      expect(res.body.message).toBe('Cannot assign an archived label');
    });

    it('PATCH null clears the label', async () => {
      const created = await postExpense({ labelId: labelA }).expect(201);

      const cleared = await request(app.getHttpServer())
        .patch(`/api/transactions/${created.body._id}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ labelId: null })
        .expect(200);
      expect(cleared.body.labelId).toBeUndefined();
    });

    it('PATCH to a transfer without labelId drops the stored label', async () => {
      const created = await postExpense({ labelId: labelA }).expect(201);

      const res = await request(app.getHttpServer())
        .patch(`/api/transactions/${created.body._id}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ type: 'transfer', transferAccountId: savingsA })
        .expect(200);
      expect(res.body.type).toBe('transfer');
      expect(res.body.labelId).toBeUndefined();
      expect(res.body.categoryId).toBeUndefined();
    });

    it('PATCH to a transfer that explicitly sends a label is 400', async () => {
      const created = await postExpense({ labelId: labelA }).expect(201);

      const res = await request(app.getHttpServer())
        .patch(`/api/transactions/${created.body._id}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          type: 'transfer',
          transferAccountId: savingsA,
          labelId: labelA,
        })
        .expect(400);
      expect(res.body.message).toBe('A transfer cannot carry a label');
    });

    it('PATCH of only the amount keeps the label', async () => {
      const created = await postExpense({ labelId: labelA }).expect(201);

      const res = await request(app.getHttpServer())
        .patch(`/api/transactions/${created.body._id}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ amountCents: 3400 })
        .expect(200);
      expect(res.body.amountCents).toBe(3400);
      expect(res.body.labelId).toBe(labelA);
    });

    it('?labelId=none returns only unlabeled rows and ?labelId=<id> only that label', async () => {
      const labeled = await postExpense({ labelId: labelA }).expect(201);
      const unlabeled = await postExpense({}).expect(201);

      const none = await request(app.getHttpServer())
        .get('/api/transactions?labelId=none&limit=0')
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);
      const noneIds = none.body.data.map((t: { _id: string }) => t._id);
      expect(noneIds).toContain(unlabeled.body._id);
      expect(noneIds).not.toContain(labeled.body._id);
      expect(
        none.body.data.every((t: { labelId?: string }) => !t.labelId),
      ).toBe(true);

      const byLabel = await request(app.getHttpServer())
        .get(`/api/transactions?labelId=${labelA}&limit=0`)
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);
      const byLabelIds = byLabel.body.data.map((t: { _id: string }) => t._id);
      expect(byLabelIds).toContain(labeled.body._id);
      expect(byLabelIds).not.toContain(unlabeled.body._id);
      expect(
        byLabel.body.data.every(
          (t: { labelId?: string }) => t.labelId === labelA,
        ),
      ).toBe(true);
      expect(byLabel.body.meta.total).toBe(byLabel.body.data.length);
    });

    it('rejects a malformed labelId filter with 400', async () => {
      await request(app.getHttpServer())
        .get('/api/transactions?labelId=personal')
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(400);
    });
  });

  describe('reimbursement (VEG-700)', () => {
    let label: string;
    let account: string;

    function post(token: string, body: Record<string, unknown>) {
      return request(app.getHttpServer())
        .post('/api/transactions')
        .set('Authorization', `Bearer ${token}`)
        .send(body);
    }

    function postExpense(body: Record<string, unknown>) {
      return post(tokenA, {
        accountId: account,
        type: 'expense',
        amountCents: 2500,
        date: '2026-09-01',
        categoryId: expenseCatA,
        labelId: label,
        ...body,
      });
    }

    function patch(id: string, body: Record<string, unknown>) {
      return request(app.getHttpServer())
        .patch(`/api/transactions/${id}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send(body);
    }

    beforeAll(async () => {
      const res = await request(app.getHttpServer())
        .post('/api/labels')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ name: 'Consulting', color: '#996633' })
        .expect(201);
      label = res.body._id;
      // A dedicated account keeps these rows, and the income delete below,
      // off the balances other blocks assert on.
      account = await createAccount(app, tokenA, {
        name: 'Reimbursement Checking',
        type: 'checking',
      });
    });

    it('saves a labeled expense as owed', async () => {
      const res = await postExpense({
        reimbursement: { status: 'owed' },
      }).expect(201);
      expect(res.body.reimbursement.status).toBe('owed');
    });

    it('rejects a block on an unlabeled expense with 400', async () => {
      const res = await postExpense({
        labelId: undefined,
        reimbursement: { status: 'owed' },
      }).expect(400);
      expect(res.body.message).toBe(
        'Only a labeled expense can be marked reimbursable. Add a label first',
      );
    });

    it('rejects a block on a labeled income with 400', async () => {
      const res = await postExpense({
        type: 'income',
        categoryId: incomeCatA,
        reimbursement: { status: 'owed' },
      }).expect(400);
      expect(res.body.message).toBe(
        'Only an expense can be marked reimbursable',
      );
    });

    it('rejects owed with reimbursedAt with 400', async () => {
      const res = await postExpense({
        reimbursement: { status: 'owed', reimbursedAt: '2026-09-15' },
      }).expect(400);
      expect(res.body.message).toBe(
        'reimbursedAt and reimbursedByTransactionId must be absent when status is owed',
      );
    });

    it('rejects removing the label until the same patch clears the block', async () => {
      const created = await postExpense({
        reimbursement: { status: 'owed' },
      }).expect(201);

      const rejected = await patch(created.body._id, { labelId: null }).expect(
        400,
      );
      expect(rejected.body.message).toBe(
        'Clear the reimbursement before removing the label',
      );

      const cleared = await patch(created.body._id, {
        labelId: null,
        reimbursement: null,
      }).expect(200);
      expect(cleared.body.reimbursement).toBeUndefined();
      expect(cleared.body.labelId).toBeUndefined();
    });

    it.each([
      ['an array', []],
      ['an array holding a block', [{ status: 'owed' }]],
    ])('rejects %s as the block with 400', async (_name, reimbursement) => {
      await postExpense({ reimbursement }).expect(400);
    });

    describe('malformed block values', () => {
      const cases: [string, Record<string, unknown>][] = [
        ['an unknown status', { status: 'bogus' }],
        [
          'a reimbursedAt that is not a date',
          { status: 'reimbursed', reimbursedAt: 'not-a-date' },
        ],
        [
          'a link that is not an id',
          {
            status: 'reimbursed',
            reimbursedAt: '2026-09-15',
            reimbursedByTransactionId: 'nope',
          },
        ],
        ['an empty block with no status', {}],
      ];

      it.each(cases)('POST rejects %s with 400', async (_name, block) => {
        await postExpense({ reimbursement: block }).expect(400);
      });

      it.each(cases)('PATCH rejects %s with 400', async (_name, block) => {
        const created = await postExpense({
          reimbursement: { status: 'owed' },
        }).expect(201);

        await patch(created.body._id, { reimbursement: block }).expect(400);
      });
    });

    // An income and a labeled expense it paid back, linked.
    async function linkedPair(): Promise<{
      expenseId: string;
      incomeId: string;
    }> {
      const income = await post(tokenA, {
        accountId: account,
        type: 'income',
        amountCents: 2500,
        date: '2026-09-15',
        categoryId: incomeCatA,
      }).expect(201);
      const expense = await postExpense({
        reimbursement: {
          status: 'reimbursed',
          reimbursedAt: '2026-09-15',
          reimbursedByTransactionId: income.body._id,
        },
      }).expect(201);
      return { expenseId: expense.body._id, incomeId: income.body._id };
    }

    function getTxn(id: string) {
      return request(app.getHttpServer())
        .get(`/api/transactions/${id}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);
    }

    it('an amount-only edit leaves a linked block unchanged', async () => {
      const { expenseId, incomeId } = await linkedPair();

      await patch(expenseId, { amountCents: 2600 }).expect(200);

      const res = await getTxn(expenseId);
      expect(res.body.amountCents).toBe(2600);
      expect(res.body.reimbursement.status).toBe('reimbursed');
      expect(res.body.reimbursement.reimbursedAt).toMatch(/^2026-09-15/);
      expect(res.body.reimbursement.reimbursedByTransactionId).toBe(incomeId);
    });

    it('retyping the linked income leaves the expense reimbursed with no link', async () => {
      const { expenseId, incomeId } = await linkedPair();

      await patch(incomeId, {
        type: 'expense',
        categoryId: expenseCatA,
      }).expect(200);

      const res = await getTxn(expenseId);
      expect(res.body.reimbursement.status).toBe('reimbursed');
      expect(res.body.reimbursement.reimbursedAt).toMatch(/^2026-09-15/);
      expect(res.body.reimbursement.reimbursedByTransactionId).toBeUndefined();
    });

    describe('linked income', () => {
      let expenseId: string;
      let incomeId: string;

      beforeAll(async () => {
        const expense = await postExpense({
          reimbursement: { status: 'owed' },
        }).expect(201);
        expenseId = expense.body._id;
        const income = await post(tokenA, {
          accountId: account,
          type: 'income',
          amountCents: 2500,
          date: '2026-09-15',
          categoryId: incomeCatA,
          payee: 'Client payment',
        }).expect(201);
        incomeId = income.body._id;
      });

      it('links the expense to the income that paid it back', async () => {
        const res = await patch(expenseId, {
          reimbursement: {
            status: 'reimbursed',
            reimbursedAt: '2026-09-15',
            reimbursedByTransactionId: incomeId,
          },
        }).expect(200);
        expect(res.body.reimbursement.status).toBe('reimbursed');
        expect(res.body.reimbursement.reimbursedAt).toMatch(/^2026-09-15/);
        expect(res.body.reimbursement.reimbursedByTransactionId).toBe(incomeId);
      });

      it('rejects a link to another expense with 400', async () => {
        const other = await postExpense({}).expect(201);

        const res = await patch(expenseId, {
          reimbursement: {
            status: 'reimbursed',
            reimbursedAt: '2026-09-15',
            reimbursedByTransactionId: other.body._id,
          },
        }).expect(400);
        expect(res.body.message).toBe(
          'reimbursedByTransactionId must reference an income transaction',
        );
      });

      it("rejects a link to another household's transaction with 400", async () => {
        const foreign = await post(tokenB, {
          accountId: bAccount,
          type: 'expense',
          amountCents: 2500,
          date: '2026-09-15',
          categoryId: bCategory,
        }).expect(201);

        const res = await patch(expenseId, {
          reimbursement: {
            status: 'reimbursed',
            reimbursedAt: '2026-09-15',
            reimbursedByTransactionId: foreign.body._id,
          },
        }).expect(400);
        expect(res.body.message).toBe(
          'reimbursedByTransactionId does not reference a transaction in this household',
        );
      });

      it('rejects a transaction that links to itself with 400', async () => {
        const income = await post(tokenA, {
          accountId: account,
          type: 'income',
          amountCents: 2500,
          date: '2026-09-15',
          categoryId: incomeCatA,
          labelId: label,
        }).expect(201);

        const res = await patch(income.body._id, {
          type: 'expense',
          categoryId: expenseCatA,
          reimbursement: {
            status: 'reimbursed',
            reimbursedAt: '2026-09-15',
            reimbursedByTransactionId: income.body._id,
          },
        }).expect(400);
        expect(res.body.message).toBe(
          'reimbursedByTransactionId cannot reference the transaction itself',
        );
      });

      it('deleting the income leaves the expense reimbursed with no link', async () => {
        await request(app.getHttpServer())
          .delete(`/api/transactions/${incomeId}`)
          .set('Authorization', `Bearer ${tokenA}`)
          .expect(204);

        const res = await request(app.getHttpServer())
          .get(`/api/transactions/${expenseId}`)
          .set('Authorization', `Bearer ${tokenA}`)
          .expect(200);
        expect(res.body.reimbursement.status).toBe('reimbursed');
        expect(res.body.reimbursement.reimbursedAt).toMatch(/^2026-09-15/);
        expect(
          res.body.reimbursement.reimbursedByTransactionId,
        ).toBeUndefined();
      });

      it('undo sets the expense back to owed with no date and no link', async () => {
        const res = await patch(expenseId, {
          reimbursement: { status: 'owed' },
        }).expect(200);
        expect(res.body.reimbursement).toEqual({ status: 'owed' });
      });
    });
  });
});
