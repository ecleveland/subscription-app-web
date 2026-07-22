import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { NotificationsCronService } from './notifications-cron.service';
import { NotificationsService } from './notifications.service';
import { RecurringTransaction } from '../recurring/schemas/recurring-transaction.schema';
import { CronLockService } from '../common/cron-lock/cron-lock.service';

function cursorOf(items: any[] = []) {
  const chain: any = {};
  chain.lean = jest.fn().mockReturnValue(chain);
  chain.cursor = jest.fn().mockReturnValue({
    async *[Symbol.asyncIterator]() {
      for (const item of items) yield await Promise.resolve(item);
    },
  });
  return chain;
}

describe('NotificationsCronService', () => {
  let cronService: NotificationsCronService;
  let mockRecurringModel: any;
  let mockNotificationsService: any;
  let mockCronLock: any;

  const householdId = '507f1f77bcf86cd799439011';
  const subId = '507f1f77bcf86cd799439022';

  // A recurring subscription-slice row (VEG-469): payee/nextDate/isSubscription.
  function makeSub(overrides: Record<string, any> = {}) {
    return {
      _id: new Types.ObjectId(subId),
      householdId: new Types.ObjectId(householdId),
      payee: 'Netflix',
      nextDate: new Date('2026-03-19'),
      reminderDaysBefore: 3,
      isActive: true,
      isSubscription: true,
      ...overrides,
    };
  }

  beforeEach(async () => {
    mockRecurringModel = {
      find: jest.fn().mockReturnValue(cursorOf([])),
    };
    mockNotificationsService = {
      createRenewalReminder: jest.fn().mockResolvedValue(undefined),
    };
    mockCronLock = {
      tryAcquire: jest.fn().mockResolvedValue(true),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationsCronService,
        {
          provide: getModelToken(RecurringTransaction.name),
          useValue: mockRecurringModel,
        },
        { provide: NotificationsService, useValue: mockNotificationsService },
        { provide: CronLockService, useValue: mockCronLock },
      ],
    }).compile();

    cronService = module.get<NotificationsCronService>(
      NotificationsCronService,
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.useRealTimers();
  });

  it('skips the run when another instance holds the daily lock', async () => {
    mockCronLock.tryAcquire.mockResolvedValue(false);
    mockRecurringModel.find.mockReturnValue(cursorOf([makeSub()]));

    await cronService.handleRenewalReminders();

    expect(mockRecurringModel.find).not.toHaveBeenCalled();
    expect(
      mockNotificationsService.createRenewalReminder,
    ).not.toHaveBeenCalled();
  });

  it('acquires the lock with the UTC run-date key for the day', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-03-17T10:00:00Z'));

    await cronService.handleRenewalReminders();

    expect(mockCronLock.tryAcquire).toHaveBeenCalledWith(
      'renewal-reminders',
      '2026-03-17',
    );
  });

  it('scans only the active subscription slice due within the window', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-03-17T10:00:00Z'));
    const chain = cursorOf([]);
    mockRecurringModel.find.mockReturnValue(chain);

    await cronService.handleRenewalReminders();

    const filter = mockRecurringModel.find.mock.calls[0][0];
    expect(filter.isActive).toBe(true);
    expect(filter.isSubscription).toBe(true);
    expect(filter.reminderDaysBefore).toEqual({ $gt: 0 });
    expect(filter.nextDate).toBeDefined();
    expect(chain.lean).toHaveBeenCalled();
    expect(chain.cursor).toHaveBeenCalled();
  });

  it('creates a reminder for a subscription in the window (keyed on the preserved _id)', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-03-17T10:00:00Z'));
    mockRecurringModel.find.mockReturnValue(cursorOf([makeSub()]));

    await cronService.handleRenewalReminders();

    expect(mockNotificationsService.createRenewalReminder).toHaveBeenCalledWith(
      householdId,
      subId,
      'Netflix',
      new Date('2026-03-19'),
      3,
    );
  });

  it('does not create a reminder outside the reminder window', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-03-10T10:00:00Z'));
    mockRecurringModel.find.mockReturnValue(
      cursorOf([makeSub({ nextDate: new Date('2026-03-20') })]),
    );

    await cronService.handleRenewalReminders();

    expect(
      mockNotificationsService.createRenewalReminder,
    ).not.toHaveBeenCalled();
  });

  it('handles an empty list', async () => {
    mockRecurringModel.find.mockReturnValue(cursorOf([]));

    await cronService.handleRenewalReminders();

    expect(
      mockNotificationsService.createRenewalReminder,
    ).not.toHaveBeenCalled();
  });

  it('continues after a per-item failure (one bad sub does not drop the run)', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-03-17T10:00:00Z'));
    mockRecurringModel.find.mockReturnValue(
      cursorOf([
        makeSub({ payee: 'Bad' }),
        makeSub({
          _id: new Types.ObjectId('507f1f77bcf86cd799439044'),
          payee: 'Good',
        }),
      ]),
    );
    mockNotificationsService.createRenewalReminder
      .mockRejectedValueOnce(new Error('write failed'))
      .mockResolvedValueOnce(undefined);

    await expect(cronService.handleRenewalReminders()).resolves.toBeUndefined();

    expect(
      mockNotificationsService.createRenewalReminder,
    ).toHaveBeenCalledTimes(2);
  });

  it('processes multiple subscriptions', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-03-17T10:00:00Z'));
    mockRecurringModel.find.mockReturnValue(
      cursorOf([
        makeSub(),
        makeSub({
          _id: new Types.ObjectId('507f1f77bcf86cd799439044'),
          payee: 'Spotify',
          nextDate: new Date('2026-03-18'),
          reminderDaysBefore: 2,
        }),
      ]),
    );

    await cronService.handleRenewalReminders();

    expect(
      mockNotificationsService.createRenewalReminder,
    ).toHaveBeenCalledTimes(2);
  });

  it('skips a row with no householdId instead of aborting the run', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-03-17T10:00:00Z'));
    const orphan = makeSub({ payee: 'Orphan' });
    delete (orphan as { householdId?: unknown }).householdId;
    mockRecurringModel.find.mockReturnValue(
      cursorOf([
        orphan,
        makeSub({
          _id: new Types.ObjectId('507f1f77bcf86cd799439044'),
          payee: 'Healthy',
        }),
      ]),
    );

    await expect(cronService.handleRenewalReminders()).resolves.toBeUndefined();

    expect(
      mockNotificationsService.createRenewalReminder,
    ).toHaveBeenCalledTimes(1);
    expect(mockNotificationsService.createRenewalReminder).toHaveBeenCalledWith(
      householdId,
      '507f1f77bcf86cd799439044',
      'Healthy',
      new Date('2026-03-19'),
      3,
    );
  });
});
