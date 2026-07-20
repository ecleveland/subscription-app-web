import { Test, TestingModule } from '@nestjs/testing';
import { Logger } from '@nestjs/common';
import { RecurringCronService } from './recurring-cron.service';
import { RecurringService } from './recurring.service';
import { CronLockService } from '../common/cron-lock/cron-lock.service';

describe('RecurringCronService', () => {
  let cron: RecurringCronService;
  let mockRecurringService: { materializeDue: jest.Mock };
  let mockCronLock: { tryAcquire: jest.Mock };

  const summary = {
    scanned: 1,
    materialized: 1,
    duplicate: 0,
    skipped: 0,
    deactivated: 0,
    capped: 0,
    failed: 0,
  };

  beforeEach(async () => {
    mockRecurringService = {
      materializeDue: jest.fn().mockResolvedValue(summary),
    };
    mockCronLock = { tryAcquire: jest.fn().mockResolvedValue(true) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RecurringCronService,
        { provide: RecurringService, useValue: mockRecurringService },
        { provide: CronLockService, useValue: mockCronLock },
      ],
    }).compile();

    module.useLogger(false);
    cron = module.get<RecurringCronService>(RecurringCronService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('materializes due schedules when it wins the daily lock', async () => {
    await cron.handleMaterialization();

    expect(mockCronLock.tryAcquire).toHaveBeenCalledWith(
      'materialize-recurring',
      expect.any(String),
    );
    expect(mockRecurringService.materializeDue).toHaveBeenCalledTimes(1);
  });

  it('skips materialization when another instance holds the lock', async () => {
    mockCronLock.tryAcquire.mockResolvedValue(false);

    await cron.handleMaterialization();

    expect(mockRecurringService.materializeDue).not.toHaveBeenCalled();
  });

  // An operator filtering to warn+ would otherwise see per-schedule errors
  // with no run-level context, and a run with failures would report at the
  // same level as a clean one.
  describe('run-level log severity', () => {
    const levelSpy = (level: 'log' | 'warn' | 'error') =>
      jest.spyOn(Logger.prototype, level).mockImplementation(() => undefined);

    it('logs a clean run at info', async () => {
      const log = levelSpy('log');
      await cron.handleMaterialization();
      expect(log).toHaveBeenCalledWith(
        expect.objectContaining({ failed: 0 }),
        expect.stringContaining('complete'),
      );
    });

    it('escalates to warn when schedules were skipped', async () => {
      mockRecurringService.materializeDue.mockResolvedValue({
        ...summary,
        skipped: 2,
      });
      const warn = levelSpy('warn');
      await cron.handleMaterialization();
      expect(warn).toHaveBeenCalledWith(
        expect.objectContaining({ skipped: 2 }),
        expect.stringContaining('complete'),
      );
    });

    it('escalates to error when schedules failed', async () => {
      mockRecurringService.materializeDue.mockResolvedValue({
        ...summary,
        failed: 1,
        skipped: 3,
      });
      const error = levelSpy('error');
      await cron.handleMaterialization();
      expect(error).toHaveBeenCalledWith(
        expect.objectContaining({ failed: 1 }),
        expect.stringContaining('complete'),
      );
    });
  });

  // This is the job that writes money unattended; a throw escaping the cron
  // boundary would surface only as an unhandled rejection (there is no global
  // handler in main.ts).
  it('logs and contains an error thrown by the scan itself', async () => {
    mockRecurringService.materializeDue.mockRejectedValue(
      new Error('cursor exploded'),
    );
    const error = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);

    await expect(cron.handleMaterialization()).resolves.toBeUndefined();
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining('cursor exploded'),
    );
  });

  it('uses its own lock key, independent of the subscriptions cron', async () => {
    // Sharing a key would let whichever job ran first suppress the other for
    // the rest of the day.
    await cron.handleMaterialization();

    expect(RecurringCronService.LOCK_KEY).toBe('materialize-recurring');
    expect(mockCronLock.tryAcquire.mock.calls[0][0]).not.toBe(
      'advance-overdue-dates',
    );
  });
});
