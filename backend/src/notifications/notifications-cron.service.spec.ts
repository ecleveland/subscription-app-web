import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { NotificationsCronService } from './notifications-cron.service';
import { NotificationsService } from './notifications.service';
import { Subscription } from '../subscriptions/schemas/subscription.schema';
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
  let mockSubModel: any;
  let mockNotificationsService: any;
  let mockCronLock: any;

  const householdId = '507f1f77bcf86cd799439011';
  const subId = '507f1f77bcf86cd799439022';

  function makeSub(overrides: Record<string, any> = {}) {
    return {
      _id: new Types.ObjectId(subId),
      householdId: new Types.ObjectId(householdId),
      name: 'Netflix',
      nextBillingDate: new Date('2026-03-19'),
      reminderDaysBefore: 3,
      isActive: true,
      ...overrides,
    };
  }

  beforeEach(async () => {
    mockSubModel = {
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
        { provide: getModelToken(Subscription.name), useValue: mockSubModel },
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
    mockSubModel.find.mockReturnValue(cursorOf([makeSub()]));

    await cronService.handleRenewalReminders();

    expect(mockSubModel.find).not.toHaveBeenCalled();
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

  it('streams subscriptions with a lean cursor', async () => {
    const chain = cursorOf([]);
    mockSubModel.find.mockReturnValue(chain);

    await cronService.handleRenewalReminders();

    expect(chain.lean).toHaveBeenCalled();
    expect(chain.cursor).toHaveBeenCalled();
  });

  it('should create notifications for subscriptions in the reminder window', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-03-17T10:00:00Z'));
    mockSubModel.find.mockReturnValue(cursorOf([makeSub()]));

    await cronService.handleRenewalReminders();

    expect(mockNotificationsService.createRenewalReminder).toHaveBeenCalledWith(
      householdId,
      subId,
      'Netflix',
      new Date('2026-03-19'),
      3,
    );
  });

  it('should not create notifications for subscriptions outside the reminder window', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-03-10T10:00:00Z'));
    mockSubModel.find.mockReturnValue(
      cursorOf([makeSub({ nextBillingDate: new Date('2026-03-20') })]),
    );

    await cronService.handleRenewalReminders();

    // Reminder date would be March 17, but now is March 10 so no notification
    expect(
      mockNotificationsService.createRenewalReminder,
    ).not.toHaveBeenCalled();
  });

  it('should handle empty subscription list', async () => {
    mockSubModel.find.mockReturnValue(cursorOf([]));

    await cronService.handleRenewalReminders();

    expect(
      mockNotificationsService.createRenewalReminder,
    ).not.toHaveBeenCalled();
  });

  it('continues processing after a per-item failure (one bad sub does not drop the run)', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-03-17T10:00:00Z'));
    mockSubModel.find.mockReturnValue(
      cursorOf([
        makeSub({ name: 'Bad' }),
        makeSub({
          _id: new Types.ObjectId('507f1f77bcf86cd799439044'),
          name: 'Good',
        }),
      ]),
    );
    mockNotificationsService.createRenewalReminder
      .mockRejectedValueOnce(new Error('write failed'))
      .mockResolvedValueOnce(undefined);

    await expect(cronService.handleRenewalReminders()).resolves.toBeUndefined();

    // The second subscription is still attempted despite the first throwing.
    expect(
      mockNotificationsService.createRenewalReminder,
    ).toHaveBeenCalledTimes(2);
  });

  it('should process multiple subscriptions', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-03-17T10:00:00Z'));
    mockSubModel.find.mockReturnValue(
      cursorOf([
        makeSub(),
        makeSub({
          _id: new Types.ObjectId('507f1f77bcf86cd799439044'),
          name: 'Spotify',
          nextBillingDate: new Date('2026-03-18'),
          reminderDaysBefore: 2,
        }),
      ]),
    );

    await cronService.handleRenewalReminders();

    expect(
      mockNotificationsService.createRenewalReminder,
    ).toHaveBeenCalledTimes(2);
  });

  it('skips a subscription with no householdId instead of aborting the run', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-03-17T10:00:00Z'));
    // First sub is an un-stamped legacy orphan (no householdId); the second is
    // healthy. The orphan must be skipped without throwing so the run completes.
    const orphan = makeSub({ name: 'Orphan' });
    delete (orphan as { householdId?: unknown }).householdId;
    mockSubModel.find.mockReturnValue(
      cursorOf([
        orphan,
        makeSub({
          _id: new Types.ObjectId('507f1f77bcf86cd799439044'),
          name: 'Healthy',
        }),
      ]),
    );

    await expect(cronService.handleRenewalReminders()).resolves.toBeUndefined();

    // Only the healthy subscription produces a reminder.
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
