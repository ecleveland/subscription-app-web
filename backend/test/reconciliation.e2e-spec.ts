import { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { createTestApp, closeTestApp } from './helpers/test-app';
import { userIdFromToken } from './helpers/jwt';
import { UsersService } from '../src/users/users.service';
import { HouseholdsService } from '../src/households/households.service';
import { Account } from '../src/accounts/schemas/account.schema';
import { Category } from '../src/categories/schemas/category.schema';

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

async function postTransaction(
  app: INestApplication<App>,
  token: string,
  body: Record<string, unknown>,
): Promise<void> {
  await request(app.getHttpServer())
    .post('/api/transactions')
    .set('Authorization', `Bearer ${token}`)
    .send(body)
    .expect(201);
}

describe('Balance reconciliation (e2e)', () => {
  let app: INestApplication<App>;
  let adminToken: string;
  let userToken: string;
  let accountModel: Model<Account>;
  let categoryModel: Model<Category>;

  let householdId: string;
  let checking: string; // has a non-zero opening balance + income/expense
  let savings: string; // transfer destination
  let expenseCat: string;
  let incomeCat: string;

  // A second household, for scoped-run isolation.
  let userTokenB: string;
  let householdIdB: string;
  let checkingB: string;
  const CHECKING_B_OPENING = 5000;

  const CHECKING_OPENING = 100000;

  async function seededCategory(isIncome: boolean): Promise<string> {
    const cat = await categoryModel
      .findOne({ householdId, isIncome } as Record<string, unknown>)
      .exec();
    return (cat!._id as { toString(): string }).toString();
  }

  beforeAll(async () => {
    app = await createTestApp();
    accountModel = app.get<Model<Account>>(getModelToken(Account.name));
    categoryModel = app.get<Model<Category>>(getModelToken(Category.name));

    // First user → promoted to admin (mirrors admin.e2e-spec).
    const adminReg = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ username: 'admin', password: 'Password123' });
    const adminId = userIdFromToken(adminReg.body.access_token);
    await app.get(UsersService).update(adminId, { role: 'admin' } as never);
    const adminLogin = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ username: 'admin', password: 'Password123' });
    adminToken = adminLogin.body.access_token;

    // A regular user who owns the ledger we reconcile.
    const userReg = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ username: 'ledgeruser', password: 'Password123' });
    userToken = userReg.body.access_token;

    const membership = await app
      .get(HouseholdsService)
      .findMembershipByUser(userIdFromToken(userToken));
    householdId = (
      membership!.householdId as { toString(): string }
    ).toString();
    expenseCat = await seededCategory(false);
    incomeCat = await seededCategory(true);

    checking = await createAccount(app, userToken, {
      name: 'Checking',
      type: 'checking',
      balanceCents: CHECKING_OPENING,
    });
    savings = await createAccount(app, userToken, {
      name: 'Savings',
      type: 'savings',
    });

    // Build a ledger that exercises all three transaction types.
    await postTransaction(app, userToken, {
      accountId: checking,
      type: 'income',
      amountCents: 50000,
      date: '2026-06-01',
      categoryId: incomeCat,
    });
    await postTransaction(app, userToken, {
      accountId: checking,
      type: 'expense',
      amountCents: 20000,
      date: '2026-06-02',
      categoryId: expenseCat,
    });
    await postTransaction(app, userToken, {
      accountId: checking,
      type: 'transfer',
      amountCents: 10000,
      date: '2026-06-03',
      transferAccountId: savings,
    });

    // A second household with a single ledger-less account (balance == opening),
    // for proving a household-scoped run never touches another household.
    const userRegB = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ username: 'otheruser', password: 'Password123' });
    userTokenB = userRegB.body.access_token;
    const membershipB = await app
      .get(HouseholdsService)
      .findMembershipByUser(userIdFromToken(userTokenB));
    householdIdB = (
      membershipB!.householdId as { toString(): string }
    ).toString();
    checkingB = await createAccount(app, userTokenB, {
      name: 'B Checking',
      type: 'checking',
      balanceCents: CHECKING_B_OPENING,
    });
  });

  afterAll(async () => {
    await closeTestApp(app);
  });

  // Ledger-true balances: checking = 100000 + 50000 − 20000 − 10000 = 120000;
  // savings = 0 + 10000 (transfer destination) = 10000.
  const CHECKING_TRUE = 120000;
  const SAVINGS_TRUE = 10000;

  it('the ledger produced the expected balances before any drift', async () => {
    expect(await getBalance(app, userToken, checking)).toBe(CHECKING_TRUE);
    expect(await getBalance(app, userToken, savings)).toBe(SAVINGS_TRUE);
  });

  describe('access control', () => {
    it('rejects unauthenticated callers', async () => {
      await request(app.getHttpServer())
        .post('/api/admin/reconciliation/balances')
        .expect(401);
    });

    it('rejects non-admin callers', async () => {
      await request(app.getHttpServer())
        .post('/api/admin/reconciliation/balances')
        .set('Authorization', `Bearer ${userToken}`)
        .expect(403);
    });
  });

  describe('drift correction', () => {
    it('corrects a deliberately-drifted balance and leaves clean accounts untouched', async () => {
      // Simulate a dropped `$inc`: the checking balance is short by 7500, as if
      // a ledger row was inserted but its balance update never landed.
      await accountModel
        .updateOne(
          { _id: new Types.ObjectId(checking) } as Record<string, unknown>,
          { $inc: { balanceCents: -7500 } },
        )
        .exec();
      expect(await getBalance(app, userToken, checking)).toBe(
        CHECKING_TRUE - 7500,
      );

      const res = await request(app.getHttpServer())
        .post('/api/admin/reconciliation/balances')
        .query({ householdId })
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      const byId = Object.fromEntries(
        res.body.results.map((r: { accountId: string }) => [r.accountId, r]),
      );
      // Drifted account: corrected, drift +7500 (cache was short), opening
      // balance preserved (computed back to the ledger-true value).
      expect(byId[checking]).toMatchObject({
        driftCents: 7500,
        computedBalanceCents: CHECKING_TRUE,
        status: 'corrected',
      });
      // Clean account (incl. the transfer destination leg): untouched.
      expect(byId[savings]).toMatchObject({
        driftCents: 0,
        status: 'clean',
      });
      expect(res.body.corrected).toBe(1);

      // The cached balances now match the ledger.
      expect(await getBalance(app, userToken, checking)).toBe(CHECKING_TRUE);
      expect(await getBalance(app, userToken, savings)).toBe(SAVINGS_TRUE);
    });

    it('is idempotent: a second run corrects nothing', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/admin/reconciliation/balances')
        .query({ householdId })
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body.corrected).toBe(0);
      expect(res.body.skippedConcurrent).toBe(0);
      expect(
        res.body.results.every((r: { status: string }) => r.status === 'clean'),
      ).toBe(true);
      expect(await getBalance(app, userToken, checking)).toBe(CHECKING_TRUE);
    });
  });

  describe('dry run', () => {
    it('reports drift without writing any correction', async () => {
      await accountModel
        .updateOne(
          { _id: new Types.ObjectId(checking) } as Record<string, unknown>,
          { $inc: { balanceCents: -300 } },
        )
        .exec();

      const res = await request(app.getHttpServer())
        .post('/api/admin/reconciliation/balances')
        .query({ householdId, dryRun: 'true' })
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body.dryRun).toBe(true);
      const checkingResult = res.body.results.find(
        (r: { accountId: string }) => r.accountId === checking,
      );
      expect(checkingResult).toMatchObject({
        driftCents: 300,
        status: 'drifted',
      });
      // Nothing was written — the balance is still short.
      expect(await getBalance(app, userToken, checking)).toBe(
        CHECKING_TRUE - 300,
      );

      // A real (non-dry) run then corrects it.
      await request(app.getHttpServer())
        .post('/api/admin/reconciliation/balances')
        .query({ householdId })
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(await getBalance(app, userToken, checking)).toBe(CHECKING_TRUE);
    });

    it('dryRun=false performs a real correction (raw string, not coerced truthy)', async () => {
      // VEG-475: under enableImplicitConversion, "false" coerced to boolean
      // true, so ?dryRun=false would wrongly run dry and skip the correction.
      await accountModel
        .updateOne(
          { _id: new Types.ObjectId(checking) } as Record<string, unknown>,
          { $inc: { balanceCents: -400 } },
        )
        .exec();

      const res = await request(app.getHttpServer())
        .post('/api/admin/reconciliation/balances')
        .query({ householdId, dryRun: 'false' })
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body.dryRun).toBe(false);
      expect(res.body.corrected).toBe(1);
      // The correction was actually written.
      expect(await getBalance(app, userToken, checking)).toBe(CHECKING_TRUE);
    });

    it('rejects a non-boolean dryRun param with 400', async () => {
      await request(app.getHttpServer())
        .post('/api/admin/reconciliation/balances')
        .query({ householdId, dryRun: 'banana' })
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(400);
    });
  });

  describe('household scoping', () => {
    it('a scoped run corrects its household and never touches another', async () => {
      // Drift accounts in BOTH households.
      await accountModel
        .updateOne(
          { _id: new Types.ObjectId(checking) } as Record<string, unknown>,
          { $inc: { balanceCents: -500 } },
        )
        .exec();
      await accountModel
        .updateOne(
          { _id: new Types.ObjectId(checkingB) } as Record<string, unknown>,
          { $inc: { balanceCents: -500 } },
        )
        .exec();

      // Reconcile ONLY household A.
      const res = await request(app.getHttpServer())
        .post('/api/admin/reconciliation/balances')
        .query({ householdId })
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      // Household B's account is absent from the report and left drifted.
      expect(
        res.body.results.some(
          (r: { accountId: string }) => r.accountId === checkingB,
        ),
      ).toBe(false);
      expect(await getBalance(app, userTokenB, checkingB)).toBe(
        CHECKING_B_OPENING - 500,
      );
      // Household A was corrected.
      expect(await getBalance(app, userToken, checking)).toBe(CHECKING_TRUE);

      // Restore B so later tests see a clean slate.
      await request(app.getHttpServer())
        .post('/api/admin/reconciliation/balances')
        .query({ householdId: householdIdB })
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(await getBalance(app, userTokenB, checkingB)).toBe(
        CHECKING_B_OPENING,
      );
    });
  });

  describe('all-households sweep', () => {
    it('corrects drift without a householdId scope', async () => {
      await accountModel
        .updateOne(
          { _id: new Types.ObjectId(savings) } as Record<string, unknown>,
          { $inc: { balanceCents: 999 } },
        )
        .exec();

      const res = await request(app.getHttpServer())
        .post('/api/admin/reconciliation/balances')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      const savingsResult = res.body.results.find(
        (r: { accountId: string }) => r.accountId === savings,
      );
      expect(savingsResult).toMatchObject({
        driftCents: -999,
        status: 'corrected',
      });
      expect(await getBalance(app, userToken, savings)).toBe(SAVINGS_TRUE);
    });
  });
});
