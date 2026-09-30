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

  const billId = '507f1f77bcf86cd799439066';

  // A non-subscription bill/income schedule (VEG-468).
  function makeBill(overrides: Record<string, any> = {}) {
    return {
      _id: new Types.ObjectId(billId),
      householdId: new Types.ObjectId(householdId),
      payee: 'Acme Power',
      amountCents: 4200,
      type: 'expense',
      nextDate: new Date('2026-03-19'),
      reminderDaysBefore: 3,
      isActive: true,
      isSubscription: false,
      ...overrides,
    };
  }

  beforeEach(async () => {
    mockRecurringModel = {
      find: jest.fn().mockReturnValue(cursorOf([])),
    };
    mockNotificationsService = {
      createRenewalReminder: jest.fn().mockResolvedValue(undefined),
      createBillReminder: jest.fn().mockResolvedValue(undefined),
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

    await cronService.handleReminders();

    expect(mockRecurringModel.find).not.toHaveBeenCalled();
    expect(
      mockNotificationsService.createRenewalReminder,
    ).not.toHaveBeenCalled();
  });

  it('acquires the lock with the UTC run-date key for the day', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-03-17T10:00:00Z'));

    await cronService.handleReminders();

    expect(mockCronLock.tryAcquire).toHaveBeenCalledWith(
      'renewal-reminders',
      '2026-03-17',
    );
  });

  it('scans every active schedule with a reminder, from the start of tomorrow (UTC)', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-03-17T10:00:00Z'));
    const chain = cursorOf([]);
    mockRecurringModel.find.mockReturnValue(chain);

    await cronService.handleReminders();

    const filter = mockRecurringModel.find.mock.calls[0][0];
    expect(filter.isActive).toBe(true);
    expect(filter.isSubscription).toBeUndefined();
    expect(filter.reminderDaysBefore).toEqual({ $gt: 0 });
    expect(filter.nextDate.$gte).toEqual(new Date('2026-03-18T00:00:00Z'));
    expect(filter.nextDate.$lte).toEqual(new Date('2026-04-17T00:00:00Z'));
    expect(chain.lean).toHaveBeenCalled();
    expect(chain.cursor).toHaveBeenCalled();
  });

  it('creates a reminder for a subscription in the window (keyed on the preserved _id)', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-03-17T10:00:00Z'));
    mockRecurringModel.find.mockReturnValue(cursorOf([makeSub()]));

    await cronService.handleReminders();

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

    await cronService.handleReminders();

    expect(
      mockNotificationsService.createRenewalReminder,
    ).not.toHaveBeenCalled();
  });

  it('handles an empty list', async () => {
    mockRecurringModel.find.mockReturnValue(cursorOf([]));

    await cronService.handleReminders();

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

    await expect(cronService.handleReminders()).resolves.toBeUndefined();

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

    await cronService.handleReminders();

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

    await expect(cronService.handleReminders()).resolves.toBeUndefined();

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
  describe('bill and income schedules (VEG-468)', () => {
    beforeEach(() => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2026-03-17T10:00:00Z'));
    });

    it('creates a bill reminder for an expense schedule in its window', async () => {
      mockRecurringModel.find.mockReturnValue(cursorOf([makeBill()]));

      await cronService.handleReminders();

      expect(mockNotificationsService.createBillReminder).toHaveBeenCalledWith(
        householdId,
        billId,
        'Acme Power',
        4200,
        new Date('2026-03-19'),
        2,
      );
      expect(
        mockNotificationsService.createRenewalReminder,
      ).not.toHaveBeenCalled();
    });

    it('creates a bill reminder for an income schedule too (no type special-casing)', async () => {
      mockRecurringModel.find.mockReturnValue(
        cursorOf([
          makeBill({
            payee: 'Paycheck',
            type: 'income',
            amountCents: 250000,
            nextDate: new Date('2026-03-18'),
            reminderDaysBefore: 1,
          }),
        ]),
      );

      await cronService.handleReminders();

      expect(mockNotificationsService.createBillReminder).toHaveBeenCalledWith(
        householdId,
        billId,
        'Paycheck',
        250000,
        new Date('2026-03-18'),
        1,
      );
    });

    it('routes a subscription row to createRenewalReminder, not createBillReminder', async () => {
      mockRecurringModel.find.mockReturnValue(cursorOf([makeSub()]));

      await cronService.handleReminders();

      expect(
        mockNotificationsService.createRenewalReminder,
      ).toHaveBeenCalledTimes(1);
      expect(
        mockNotificationsService.createBillReminder,
      ).not.toHaveBeenCalled();
    });

    it('does not remind for a bill due today (same UTC day)', async () => {
      mockRecurringModel.find.mockReturnValue(
        cursorOf([makeBill({ nextDate: new Date('2026-03-17T23:00:00Z') })]),
      );

      await cronService.handleReminders();

      expect(
        mockNotificationsService.createBillReminder,
      ).not.toHaveBeenCalled();
    });

    it('does not remind for a bill outside its window', async () => {
      mockRecurringModel.find.mockReturnValue(
        cursorOf([makeBill({ nextDate: new Date('2026-03-21') })]),
      );

      await cronService.handleReminders();

      expect(
        mockNotificationsService.createBillReminder,
      ).not.toHaveBeenCalled();
    });

    it('a failed bill reminder does not stop the following subscription row', async () => {
      mockRecurringModel.find.mockReturnValue(
        cursorOf([makeBill(), makeSub()]),
      );
      mockNotificationsService.createBillReminder.mockRejectedValueOnce(
        new Error('write failed'),
      );

      await expect(cronService.handleReminders()).resolves.toBeUndefined();

      expect(mockNotificationsService.createBillReminder).toHaveBeenCalledTimes(
        1,
      );
      expect(
        mockNotificationsService.createRenewalReminder,
      ).toHaveBeenCalledTimes(1);
    });
  });
});
