import { Test, TestingModule } from '@nestjs/testing';
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
