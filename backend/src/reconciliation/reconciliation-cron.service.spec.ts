import { Test, TestingModule } from '@nestjs/testing';
import { Logger } from '@nestjs/common';
import { ReconciliationCronService } from './reconciliation-cron.service';
import { ReconciliationService } from './reconciliation.service';
import { RecurringCronService } from '../recurring/recurring-cron.service';
import { CronLockService } from '../common/cron-lock/cron-lock.service';
import type { ReconciliationSummary } from './interfaces/reconciliation-report.interface';

describe('ReconciliationCronService', () => {
  let cron: ReconciliationCronService;
  let mockReconciliation: { reconcile: jest.Mock };
  let mockCronLock: { tryAcquire: jest.Mock };

  // Typed, so a field added to ReconciliationSummary fails to compile here
  // rather than silently leaving this fixture stale.
  const summary: ReconciliationSummary = {
    dryRun: false,
    householdsScanned: 1,
    accountsScanned: 2,
    corrected: 0,
    skippedConcurrent: 0,
    drifted: 0,
    skippedNoAnchor: 0,
    totalDriftCents: 0,
    results: [],
  };

  beforeEach(async () => {
    mockReconciliation = { reconcile: jest.fn().mockResolvedValue(summary) };
    mockCronLock = { tryAcquire: jest.fn().mockResolvedValue(true) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReconciliationCronService,
        { provide: ReconciliationService, useValue: mockReconciliation },
        { provide: CronLockService, useValue: mockCronLock },
      ],
    }).compile();

    module.useLogger(false);
    cron = module.get<ReconciliationCronService>(ReconciliationCronService);
  });

  afterEach(() => jest.restoreAllMocks());

  it('sweeps all households when it wins the weekly lock', async () => {
    await cron.handleReconciliation();

    expect(mockCronLock.tryAcquire).toHaveBeenCalledWith(
      'reconcile-balances',
      expect.any(String),
    );
    // No householdId → all-households sweep, non-dry.
    expect(mockReconciliation.reconcile).toHaveBeenCalledTimes(1);
    expect(mockReconciliation.reconcile).toHaveBeenCalledWith();
  });

  it('skips the sweep when another instance holds the lock', async () => {
    mockCronLock.tryAcquire.mockResolvedValue(false);

    await cron.handleReconciliation();

    expect(mockReconciliation.reconcile).not.toHaveBeenCalled();
  });

  describe('run-level log severity', () => {
    const levelSpy = (level: 'log' | 'warn') =>
      jest.spyOn(Logger.prototype, level).mockImplementation(() => undefined);

    it('logs a clean run at info', async () => {
      const log = levelSpy('log');
      await cron.handleReconciliation();
      expect(log).toHaveBeenCalledWith(
        expect.objectContaining({ corrected: 0, skippedNoAnchor: 0 }),
        expect.stringContaining('complete'),
      );
    });

    it('escalates to warn when drift was corrected', async () => {
      mockReconciliation.reconcile.mockResolvedValue({
        ...summary,
        corrected: 2,
      });
      const warn = levelSpy('warn');
      await cron.handleReconciliation();
      expect(warn).toHaveBeenCalledWith(
        expect.objectContaining({ corrected: 2 }),
        expect.stringContaining('complete'),
      );
    });

    it('escalates to warn when accounts could not be reconciled (no anchor)', async () => {
      mockReconciliation.reconcile.mockResolvedValue({
        ...summary,
        skippedNoAnchor: 5,
      });
      const warn = levelSpy('warn');
      await cron.handleReconciliation();
      expect(warn).toHaveBeenCalledWith(
        expect.objectContaining({ skippedNoAnchor: 5 }),
        expect.stringContaining('complete'),
      );
    });
  });

  // This job writes money unattended; a throw escaping the cron boundary would
  // surface only as an unhandled rejection (no global handler in main.ts).
  it('logs and contains an error thrown by the sweep', async () => {
    mockReconciliation.reconcile.mockRejectedValue(
      new Error('cursor exploded'),
    );
    const error = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);

    await expect(cron.handleReconciliation()).resolves.toBeUndefined();
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining('cursor exploded'),
    );
  });

  it('uses a lock key distinct from every other cron', async () => {
    // Sharing a key would let whichever job ran first suppress the other.
    // Compare against the REAL constants so a rename INTO a collision is caught.
    const keys = [
      ReconciliationCronService.LOCK_KEY,
      RecurringCronService.LOCK_KEY,
    ];
    expect(new Set(keys).size).toBe(keys.length);

    await cron.handleReconciliation();
    expect(mockCronLock.tryAcquire.mock.calls[0][0]).toBe(
      ReconciliationCronService.LOCK_KEY,
    );
  });
});
