import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { NotificationsCronService } from './notifications-cron.service';
import { NotificationsService } from './notifications.service';
import { Subscription } from '../subscriptions/schemas/subscription.schema';

function createChainable(resolvedValue: any = null) {
  const chain: any = {};
  chain.sort = jest.fn().mockReturnValue(chain);
  chain.exec = jest.fn().mockResolvedValue(resolvedValue);
  return chain;
}

describe('NotificationsCronService', () => {
  let cronService: NotificationsCronService;
  let mockSubModel: any;
  let mockNotificationsService: any;

  const userId = '507f1f77bcf86cd799439011';
  const subId = '507f1f77bcf86cd799439022';

  beforeEach(async () => {
    mockSubModel = {
      find: jest.fn().mockReturnValue(createChainable([])),
    };

    mockNotificationsService = {
      createRenewalReminder: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationsCronService,
        {
          provide: getModelToken(Subscription.name),
          useValue: mockSubModel,
        },
        {
          provide: NotificationsService,
          useValue: mockNotificationsService,
        },
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

  it('should create notifications for subscriptions in the reminder window', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-03-17T10:00:00Z'));

    const sub = {
      _id: new Types.ObjectId(subId),
      userId: new Types.ObjectId(userId),
      name: 'Netflix',
      nextBillingDate: new Date('2026-03-19'),
      reminderDaysBefore: 3,
      isActive: true,
    };

    mockSubModel.find.mockReturnValue(createChainable([sub]));

    await cronService.handleRenewalReminders();

    expect(mockNotificationsService.createRenewalReminder).toHaveBeenCalledWith(
      userId,
      subId,
      'Netflix',
      new Date('2026-03-19'),
      3,
    );
  });

  it('should not create notifications for subscriptions outside the reminder window', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-03-10T10:00:00Z'));

    const sub = {
      _id: new Types.ObjectId(subId),
      userId: new Types.ObjectId(userId),
      name: 'Netflix',
      nextBillingDate: new Date('2026-03-20'),
      reminderDaysBefore: 3,
      isActive: true,
    };

    mockSubModel.find.mockReturnValue(createChainable([sub]));

    await cronService.handleRenewalReminders();

    // Reminder date would be March 17, but now is March 10 so no notification
    expect(
      mockNotificationsService.createRenewalReminder,
    ).not.toHaveBeenCalled();
  });

  it('should handle empty subscription list', async () => {
    mockSubModel.find.mockReturnValue(createChainable([]));

    await cronService.handleRenewalReminders();

    expect(
      mockNotificationsService.createRenewalReminder,
    ).not.toHaveBeenCalled();
  });

  it('should process multiple subscriptions', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-03-17T10:00:00Z'));

    const subs = [
      {
        _id: new Types.ObjectId(subId),
        userId: new Types.ObjectId(userId),
        name: 'Netflix',
        nextBillingDate: new Date('2026-03-19'),
        reminderDaysBefore: 3,
        isActive: true,
      },
      {
        _id: new Types.ObjectId('507f1f77bcf86cd799439044'),
        userId: new Types.ObjectId(userId),
        name: 'Spotify',
        nextBillingDate: new Date('2026-03-18'),
        reminderDaysBefore: 2,
        isActive: true,
      },
    ];

    mockSubModel.find.mockReturnValue(createChainable(subs));

    await cronService.handleRenewalReminders();

    expect(
      mockNotificationsService.createRenewalReminder,
    ).toHaveBeenCalledTimes(2);
  });
});
