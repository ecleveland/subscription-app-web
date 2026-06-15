import { Test, TestingModule } from '@nestjs/testing';
import { SubscriptionsCronService } from './subscriptions-cron.service';
import { SubscriptionsService } from './subscriptions.service';
import { CronLockService } from '../common/cron-lock/cron-lock.service';

describe('SubscriptionsCronService', () => {
  let cron: SubscriptionsCronService;
  let mockSubsService: { advanceOverdueDates: jest.Mock };
  let mockCronLock: { tryAcquire: jest.Mock };

  beforeEach(async () => {
    mockSubsService = { advanceOverdueDates: jest.fn().mockResolvedValue(0) };
    mockCronLock = { tryAcquire: jest.fn().mockResolvedValue(true) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SubscriptionsCronService,
        { provide: SubscriptionsService, useValue: mockSubsService },
        { provide: CronLockService, useValue: mockCronLock },
      ],
    }).compile();

    cron = module.get<SubscriptionsCronService>(SubscriptionsCronService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('advances overdue dates when it wins the daily lock', async () => {
    await cron.handleOverdueAdvancement();

    expect(mockCronLock.tryAcquire).toHaveBeenCalledWith(
      'advance-overdue-dates',
      expect.any(String),
    );
    expect(mockSubsService.advanceOverdueDates).toHaveBeenCalledTimes(1);
  });

  it('skips advancement when another instance holds the lock', async () => {
    mockCronLock.tryAcquire.mockResolvedValue(false);

    await cron.handleOverdueAdvancement();

    expect(mockSubsService.advanceOverdueDates).not.toHaveBeenCalled();
  });
});
