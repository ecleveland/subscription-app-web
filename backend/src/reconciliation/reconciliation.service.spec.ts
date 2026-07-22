import { Test, TestingModule } from '@nestjs/testing';
import { Logger } from '@nestjs/common';
import { ReconciliationService } from './reconciliation.service';
import { AccountsService } from '../accounts/accounts.service';
import { TransactionsService } from '../transactions/transactions.service';
import type { AccountBalanceView } from '../accounts/accounts.service';

const HOUSEHOLD_ID = '507f191e810c19729de860ea';
const OTHER_HOUSEHOLD_ID = '507f191e810c19729de860eb';
const ACC_INCOME = '507f191e810c19729de860a1';
const ACC_EXPENSE = '507f191e810c19729de860a2';
const ACC_SRC = '507f191e810c19729de860a3';
const ACC_DST = '507f191e810c19729de860a4';

function view(overrides: Partial<AccountBalanceView>): AccountBalanceView {
  return {
    id: ACC_INCOME,
    householdId: HOUSEHOLD_ID,
    name: 'Account',
    balanceCents: 0,
    openingBalanceCents: 0,
    ...overrides,
  };
}

describe('ReconciliationService', () => {
  let service: ReconciliationService;
  let accountsService: {
    findForReconcile: jest.Mock;
    compareAndSetBalance: jest.Mock;
    findAccountsMissingOpeningBalance: jest.Mock;
    setOpeningBalanceIfUnset: jest.Mock;
  };
  let transactionsService: { sumLedgerDeltasByAccount: jest.Mock };

  beforeEach(async () => {
    accountsService = {
      findForReconcile: jest.fn().mockResolvedValue([]),
      compareAndSetBalance: jest.fn().mockResolvedValue(true),
      findAccountsMissingOpeningBalance: jest.fn().mockResolvedValue([]),
      setOpeningBalanceIfUnset: jest.fn().mockResolvedValue(true),
    };
    transactionsService = {
      sumLedgerDeltasByAccount: jest.fn().mockResolvedValue(new Map()),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReconciliationService,
        { provide: AccountsService, useValue: accountsService },
        { provide: TransactionsService, useValue: transactionsService },
      ],
    }).compile();

    module.useLogger(false);
    service = module.get<ReconciliationService>(ReconciliationService);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => jest.clearAllMocks());

  describe('reconcile — recompute math for all three transaction types', () => {
    it('recomputes balanceCents as openingBalanceCents + Σ(ledger) per account and reports drift', async () => {
      accountsService.findForReconcile.mockResolvedValue([
        // income account: opening 1000, ledger +4200 → computed 5200 (cache short by 200)
        view({
          id: ACC_INCOME,
          openingBalanceCents: 1000,
          balanceCents: 5000,
        }),
        // expense account: opening 8000, ledger −4200 → computed 3800 (clean)
        view({
          id: ACC_EXPENSE,
          openingBalanceCents: 8000,
          balanceCents: 3800,
        }),
        // transfer source: opening 0, ledger −1000 → computed −1000 (cache long by 1000)
        view({ id: ACC_SRC, openingBalanceCents: 0, balanceCents: 0 }),
        // transfer destination: opening 0, ledger +1000 → computed 1000 (clean)
        view({ id: ACC_DST, openingBalanceCents: 0, balanceCents: 1000 }),
      ]);
      transactionsService.sumLedgerDeltasByAccount.mockResolvedValue(
        new Map([
          [ACC_INCOME, 4200],
          [ACC_EXPENSE, -4200],
          [ACC_SRC, -1000],
          [ACC_DST, 1000],
        ]),
      );

      const summary = await service.reconcile({ householdId: HOUSEHOLD_ID });

      const byId = Object.fromEntries(
        summary.results.map((r) => [r.accountId, r]),
      );
      // Income account: short → corrected up to 5200, drift +200.
      expect(byId[ACC_INCOME]).toMatchObject({
        computedBalanceCents: 5200,
        driftCents: 200,
        status: 'corrected',
      });
      // Expense account: clean, untouched.
      expect(byId[ACC_EXPENSE]).toMatchObject({
        computedBalanceCents: 3800,
        driftCents: 0,
        status: 'clean',
      });
      // Transfer source leg: long → corrected down to −1000, drift −1000.
      expect(byId[ACC_SRC]).toMatchObject({
        computedBalanceCents: -1000,
        driftCents: -1000,
        status: 'corrected',
      });
      // Transfer destination leg (+amount): clean.
      expect(byId[ACC_DST]).toMatchObject({
        computedBalanceCents: 1000,
        driftCents: 0,
        status: 'clean',
      });

      expect(summary.accountsScanned).toBe(4);
      expect(summary.corrected).toBe(2);
      expect(summary.totalDriftCents).toBe(1200); // |200| + |1000|
      // Clean accounts are never written.
      expect(accountsService.compareAndSetBalance).toHaveBeenCalledTimes(2);
      expect(accountsService.compareAndSetBalance).toHaveBeenCalledWith(
        HOUSEHOLD_ID,
        ACC_INCOME,
        5000,
        5200,
      );
    });

    it('scopes the ledger sum and account scan to the given household', async () => {
      await service.reconcile({ householdId: HOUSEHOLD_ID });

      expect(accountsService.findForReconcile).toHaveBeenCalledWith(
        HOUSEHOLD_ID,
      );
      expect(transactionsService.sumLedgerDeltasByAccount).toHaveBeenCalledWith(
        HOUSEHOLD_ID,
      );
    });

    it('sweeps all households when none is given', async () => {
      await service.reconcile();

      expect(accountsService.findForReconcile).toHaveBeenCalledWith(undefined);
      expect(transactionsService.sumLedgerDeltasByAccount).toHaveBeenCalledWith(
        undefined,
      );
    });

    it('counts distinct households scanned', async () => {
      accountsService.findForReconcile.mockResolvedValue([
        view({ id: ACC_INCOME, householdId: HOUSEHOLD_ID, balanceCents: 0 }),
        view({ id: ACC_SRC, householdId: OTHER_HOUSEHOLD_ID, balanceCents: 0 }),
      ]);

      const summary = await service.reconcile();

      expect(summary.householdsScanned).toBe(2);
    });
  });

  describe('reconcile — concurrency and idempotency', () => {
    it('reports skipped-concurrent (never clobbers) when the compare-and-set misses', async () => {
      accountsService.findForReconcile.mockResolvedValue([
        view({ id: ACC_INCOME, openingBalanceCents: 1000, balanceCents: 5000 }),
      ]);
      transactionsService.sumLedgerDeltasByAccount.mockResolvedValue(
        new Map([[ACC_INCOME, 4200]]),
      );
      accountsService.compareAndSetBalance.mockResolvedValue(false);

      const summary = await service.reconcile({ householdId: HOUSEHOLD_ID });

      expect(summary.results[0].status).toBe('skipped-concurrent');
      expect(summary.skippedConcurrent).toBe(1);
      expect(summary.corrected).toBe(0);
    });

    it('skips an account still missing its opening-balance anchor rather than wiping it or aborting the run', async () => {
      accountsService.findForReconcile.mockResolvedValue([
        // Missing anchor (e.g. partial boot backfill): openingBalanceCents absent.
        view({
          id: ACC_INCOME,
          openingBalanceCents: undefined as unknown as number,
          balanceCents: 5000,
        }),
        // A well-formed account in the same run is still reconciled.
        view({ id: ACC_SRC, openingBalanceCents: 0, balanceCents: 0 }),
      ]);
      transactionsService.sumLedgerDeltasByAccount.mockResolvedValue(
        new Map([
          [ACC_INCOME, 4200],
          [ACC_SRC, -1000],
        ]),
      );

      const summary = await service.reconcile();

      // The un-anchored account is neither corrected nor reported (no wipe).
      expect(
        summary.results.find((r) => r.accountId === ACC_INCOME),
      ).toBeUndefined();
      expect(accountsService.compareAndSetBalance).not.toHaveBeenCalledWith(
        HOUSEHOLD_ID,
        ACC_INCOME,
        expect.anything(),
        expect.anything(),
      );
      // The healthy account is still corrected.
      expect(
        summary.results.find((r) => r.accountId === ACC_SRC),
      ).toMatchObject({ status: 'corrected', computedBalanceCents: -1000 });
    });

    it('leaves an already-reconciled account untouched (idempotent second run)', async () => {
      accountsService.findForReconcile.mockResolvedValue([
        view({ id: ACC_INCOME, openingBalanceCents: 1000, balanceCents: 5200 }),
      ]);
      transactionsService.sumLedgerDeltasByAccount.mockResolvedValue(
        new Map([[ACC_INCOME, 4200]]),
      );

      const summary = await service.reconcile({ householdId: HOUSEHOLD_ID });

      expect(summary.results[0].status).toBe('clean');
      expect(summary.corrected).toBe(0);
      expect(accountsService.compareAndSetBalance).not.toHaveBeenCalled();
    });
  });

  describe('reconcile — dry run', () => {
    it('reports drift as "drifted" without writing any correction', async () => {
      accountsService.findForReconcile.mockResolvedValue([
        view({ id: ACC_INCOME, openingBalanceCents: 1000, balanceCents: 5000 }),
      ]);
      transactionsService.sumLedgerDeltasByAccount.mockResolvedValue(
        new Map([[ACC_INCOME, 4200]]),
      );

      const summary = await service.reconcile({
        householdId: HOUSEHOLD_ID,
        dryRun: true,
      });

      expect(summary.dryRun).toBe(true);
      expect(summary.results[0]).toMatchObject({
        driftCents: 200,
        status: 'drifted',
      });
      expect(summary.drifted).toBe(1);
      expect(summary.totalDriftCents).toBe(200);
      expect(accountsService.compareAndSetBalance).not.toHaveBeenCalled();
    });
  });

  describe('backfillOpeningBalances', () => {
    it('stamps openingBalanceCents = balanceCents − Σ(ledger) on legacy accounts', async () => {
      accountsService.findAccountsMissingOpeningBalance.mockResolvedValue([
        { id: ACC_INCOME, householdId: HOUSEHOLD_ID, balanceCents: 5200 },
        { id: ACC_SRC, householdId: HOUSEHOLD_ID, balanceCents: -1000 },
      ]);
      transactionsService.sumLedgerDeltasByAccount.mockResolvedValue(
        new Map([
          [ACC_INCOME, 4200],
          [ACC_SRC, -1000],
        ]),
      );

      const stamped = await service.backfillOpeningBalances();

      expect(stamped).toBe(2);
      // opening = 5200 − 4200 = 1000
      expect(accountsService.setOpeningBalanceIfUnset).toHaveBeenCalledWith(
        ACC_INCOME,
        1000,
      );
      // opening = −1000 − (−1000) = 0
      expect(accountsService.setOpeningBalanceIfUnset).toHaveBeenCalledWith(
        ACC_SRC,
        0,
      );
    });

    it('treats an account with no ledger rows as opening = current balance', async () => {
      accountsService.findAccountsMissingOpeningBalance.mockResolvedValue([
        { id: ACC_INCOME, householdId: HOUSEHOLD_ID, balanceCents: 7500 },
      ]);
      transactionsService.sumLedgerDeltasByAccount.mockResolvedValue(new Map());

      await service.backfillOpeningBalances();

      expect(accountsService.setOpeningBalanceIfUnset).toHaveBeenCalledWith(
        ACC_INCOME,
        7500,
      );
    });

    it('is a no-op when no legacy accounts remain (does not scan the ledger)', async () => {
      accountsService.findAccountsMissingOpeningBalance.mockResolvedValue([]);

      const stamped = await service.backfillOpeningBalances();

      expect(stamped).toBe(0);
      expect(
        transactionsService.sumLedgerDeltasByAccount,
      ).not.toHaveBeenCalled();
      expect(accountsService.setOpeningBalanceIfUnset).not.toHaveBeenCalled();
    });

    it('counts only the accounts it actually stamped (concurrent-boot loser no-ops)', async () => {
      accountsService.findAccountsMissingOpeningBalance.mockResolvedValue([
        { id: ACC_INCOME, householdId: HOUSEHOLD_ID, balanceCents: 5200 },
      ]);
      transactionsService.sumLedgerDeltasByAccount.mockResolvedValue(new Map());
      accountsService.setOpeningBalanceIfUnset.mockResolvedValue(false);

      expect(await service.backfillOpeningBalances()).toBe(0);
    });
  });
});
