import { Test, TestingModule } from '@nestjs/testing';
import { SubscriptionsController } from './subscriptions.controller';
import { SubscriptionsService } from './subscriptions.service';
import { BillingCycle } from './schemas/subscription.schema';

describe('SubscriptionsController', () => {
  let controller: SubscriptionsController;
  let service: jest.Mocked<
    Pick<
      SubscriptionsService,
      'create' | 'findAll' | 'findOne' | 'update' | 'remove'
    >
  >;

  const mockReq = {
    user: { userId: 'user-id-123', username: 'testuser', role: 'user' },
  } as any;

  const mockSubscription = {
    _id: 'sub-id-1',
    name: 'Netflix',
    cost: 15.99,
    billingCycle: BillingCycle.MONTHLY,
  };

  beforeEach(async () => {
    service = {
      create: jest.fn().mockResolvedValue(mockSubscription),
      findAll: jest.fn().mockResolvedValue([mockSubscription]),
      findOne: jest.fn().mockResolvedValue(mockSubscription),
      update: jest
        .fn()
        .mockResolvedValue({ ...mockSubscription, name: 'Updated' }),
      remove: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [SubscriptionsController],
      providers: [{ provide: SubscriptionsService, useValue: service }],
    }).compile();

    controller = module.get<SubscriptionsController>(SubscriptionsController);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('create', () => {
    it('should pass userId and dto to service', async () => {
      const dto = {
        name: 'Netflix',
        cost: 15.99,
        billingCycle: BillingCycle.MONTHLY,
        nextBillingDate: '2025-06-01',
        category: 'Streaming',
      };
      await controller.create(mockReq, dto);

      expect(service.create).toHaveBeenCalledWith('user-id-123', dto);
    });
  });

  describe('findAll', () => {
    it('should pass userId and query to service', async () => {
      const query = { category: 'Streaming' };
      await controller.findAll(mockReq, query);

      expect(service.findAll).toHaveBeenCalledWith('user-id-123', query);
    });
  });

  describe('findOne', () => {
    it('should pass userId and id to service', async () => {
      await controller.findOne(mockReq, 'sub-id-1');

      expect(service.findOne).toHaveBeenCalledWith('user-id-123', 'sub-id-1');
    });
  });

  describe('update', () => {
    it('should pass userId, id, and dto to service', async () => {
      const dto = { name: 'Updated' };
      await controller.update(mockReq, 'sub-id-1', dto);

      expect(service.update).toHaveBeenCalledWith(
        'user-id-123',
        'sub-id-1',
        dto,
      );
    });
  });

  describe('remove', () => {
    it('should pass userId and id to service', async () => {
      await controller.remove(mockReq, 'sub-id-1');

      expect(service.remove).toHaveBeenCalledWith('user-id-123', 'sub-id-1');
    });
  });
});
