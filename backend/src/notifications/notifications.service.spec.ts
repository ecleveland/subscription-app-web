import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { NotificationsService } from './notifications.service';
import { Notification, NotificationType } from './schemas/notification.schema';

function createChainable(resolvedValue: any = null) {
  const chain: any = {};
  chain.sort = jest.fn().mockReturnValue(chain);
  chain.exec = jest.fn().mockResolvedValue(resolvedValue);
  return chain;
}

describe('NotificationsService', () => {
  let service: NotificationsService;
  let mockModel: any;

  const userId = '507f1f77bcf86cd799439011';
  const notifId = '507f1f77bcf86cd799439033';
  const subId = '507f1f77bcf86cd799439022';

  const mockNotification = {
    _id: notifId,
    userId: new Types.ObjectId(userId),
    subscriptionId: new Types.ObjectId(subId),
    type: NotificationType.RENEWAL_REMINDER,
    title: 'Netflix renewing soon',
    message: 'Your Netflix subscription renews in 3 days.',
    read: false,
    billingDate: new Date('2026-03-20'),
  };

  beforeEach(async () => {
    mockModel = jest.fn().mockImplementation((dto) => ({
      ...dto,
      save: jest.fn().mockResolvedValue({ _id: 'new-id', ...dto }),
    }));
    mockModel.find = jest.fn().mockReturnValue(createChainable([]));
    mockModel.countDocuments = jest.fn().mockReturnValue(createChainable(0));
    mockModel.findOneAndUpdate = jest
      .fn()
      .mockReturnValue(createChainable(null));
    mockModel.findOneAndDelete = jest
      .fn()
      .mockReturnValue(createChainable(null));
    mockModel.updateMany = jest
      .fn()
      .mockReturnValue(createChainable({ modifiedCount: 0 }));

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationsService,
        {
          provide: getModelToken(Notification.name),
          useValue: mockModel,
        },
      ],
    }).compile();

    service = module.get<NotificationsService>(NotificationsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('findAll', () => {
    it('should return notifications and unread count', async () => {
      const findChain = createChainable([mockNotification]);
      mockModel.find.mockReturnValue(findChain);
      mockModel.countDocuments.mockReturnValue(createChainable(1));

      const result = await service.findAll(userId, {});

      expect(result.data).toEqual([mockNotification]);
      expect(result.unreadCount).toBe(1);
      expect(mockModel.find).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: expect.any(Types.ObjectId),
        }),
      );
    });

    it('should filter by read status when provided', async () => {
      const findChain = createChainable([]);
      mockModel.find.mockReturnValue(findChain);
      mockModel.countDocuments.mockReturnValue(createChainable(0));

      await service.findAll(userId, { read: false });

      expect(mockModel.find).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: expect.any(Types.ObjectId),
          read: false,
        }),
      );
    });
  });

  describe('getUnreadCount', () => {
    it('should return the count of unread notifications', async () => {
      mockModel.countDocuments.mockReturnValue(createChainable(5));

      const result = await service.getUnreadCount(userId);

      expect(result).toBe(5);
      expect(mockModel.countDocuments).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: expect.any(Types.ObjectId),
          read: false,
        }),
      );
    });
  });

  describe('markAsRead', () => {
    it('should mark a notification as read', async () => {
      const updated = { ...mockNotification, read: true };
      mockModel.findOneAndUpdate.mockReturnValue(createChainable(updated));

      const result = await service.markAsRead(userId, notifId);

      expect(result).toEqual(updated);
      expect(mockModel.findOneAndUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          _id: expect.any(Types.ObjectId),
          userId: expect.any(Types.ObjectId),
        }),
        { read: true },
        { new: true },
      );
    });

    it('should throw NotFoundException when notification not found', async () => {
      mockModel.findOneAndUpdate.mockReturnValue(createChainable(null));

      await expect(service.markAsRead(userId, notifId)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('markAllAsRead', () => {
    it('should update all unread notifications', async () => {
      mockModel.updateMany.mockReturnValue(
        createChainable({ modifiedCount: 3 }),
      );

      await service.markAllAsRead(userId);

      expect(mockModel.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: expect.any(Types.ObjectId),
          read: false,
        }),
        { read: true },
      );
    });
  });

  describe('remove', () => {
    it('should delete a notification', async () => {
      mockModel.findOneAndDelete.mockReturnValue(
        createChainable(mockNotification),
      );

      await service.remove(userId, notifId);

      expect(mockModel.findOneAndDelete).toHaveBeenCalledWith(
        expect.objectContaining({
          _id: expect.any(Types.ObjectId),
          userId: expect.any(Types.ObjectId),
        }),
      );
    });

    it('should throw NotFoundException when notification not found', async () => {
      mockModel.findOneAndDelete.mockReturnValue(createChainable(null));

      await expect(service.remove(userId, notifId)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('createRenewalReminder', () => {
    beforeEach(() => {
      mockModel.updateOne = jest
        .fn()
        .mockReturnValue(createChainable({ upsertedCount: 1 }));
    });

    it('upserts a reminder on the unique { userId, subscriptionId, billingDate } key', async () => {
      await service.createRenewalReminder(
        userId,
        subId,
        'Netflix',
        new Date('2026-03-20'),
        3,
      );

      expect(mockModel.updateOne).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: expect.any(Types.ObjectId),
          subscriptionId: expect.any(Types.ObjectId),
          billingDate: new Date('2026-03-20'),
        }),
        expect.objectContaining({
          $setOnInsert: expect.objectContaining({
            type: NotificationType.RENEWAL_REMINDER,
            title: 'Netflix renewing soon',
            message: 'Your Netflix subscription renews in 3 days.',
            read: false,
          }),
        }),
        { upsert: true },
      );
    });

    it('should handle singular day text', async () => {
      await service.createRenewalReminder(
        userId,
        subId,
        'Netflix',
        new Date('2026-03-20'),
        1,
      );

      expect(mockModel.updateOne).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          $setOnInsert: expect.objectContaining({
            message: 'Your Netflix subscription renews in 1 day.',
          }),
        }),
        { upsert: true },
      );
    });

    it('is idempotent: an already-existing reminder is matched, not duplicated', async () => {
      mockModel.updateOne = jest
        .fn()
        .mockReturnValue(createChainable({ upsertedCount: 0 }));

      await expect(
        service.createRenewalReminder(
          userId,
          subId,
          'Netflix',
          new Date('2026-03-20'),
          3,
        ),
      ).resolves.toBeUndefined();

      expect(mockModel.updateOne).toHaveBeenCalledTimes(1);
    });

    it('propagates unexpected errors', async () => {
      mockModel.updateOne = jest.fn().mockReturnValue({
        exec: jest.fn().mockRejectedValue(new Error('Some other error')),
      });

      await expect(
        service.createRenewalReminder(
          userId,
          subId,
          'Netflix',
          new Date('2026-03-20'),
          3,
        ),
      ).rejects.toThrow('Some other error');
    });
  });
});
