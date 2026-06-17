import { Test, TestingModule } from '@nestjs/testing';
import { TransactionsController } from './transactions.controller';
import { TransactionsService } from './transactions.service';
import { TransactionType } from './schemas/transaction.schema';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { HouseholdGuard } from '../households/guards/household.guard';

describe('TransactionsController', () => {
  let controller: TransactionsController;
  let service: jest.Mocked<
    Pick<
      TransactionsService,
      'create' | 'findAll' | 'findOne' | 'update' | 'remove'
    >
  >;

  const mockReq = {
    user: { userId: 'user-1', username: 'testuser', role: 'user' },
    household: { householdId: 'hh-1', memberId: 'member-1', role: 'owner' },
  } as any;

  beforeEach(async () => {
    service = {
      create: jest.fn().mockResolvedValue({ _id: 'txn-1' }),
      findAll: jest.fn().mockResolvedValue({ data: [], meta: {} }),
      findOne: jest.fn().mockResolvedValue({ _id: 'txn-1' }),
      update: jest.fn().mockResolvedValue({ _id: 'txn-1' }),
      remove: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [TransactionsController],
      providers: [{ provide: TransactionsService, useValue: service }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(HouseholdGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<TransactionsController>(TransactionsController);
  });

  it('create passes householdId and memberId from the request', async () => {
    const dto = {
      accountId: 'a',
      type: TransactionType.EXPENSE,
      amountCents: 100,
      date: '2026-06-17',
      categoryId: 'c',
    };
    await controller.create(mockReq, dto);
    expect(service.create).toHaveBeenCalledWith('hh-1', 'member-1', dto);
  });

  it('findAll delegates with the household id and query', async () => {
    const query = { accountId: 'a' };
    await controller.findAll(mockReq, query);
    expect(service.findAll).toHaveBeenCalledWith('hh-1', query);
  });

  it('findOne delegates scoped to the household', async () => {
    await controller.findOne(mockReq, 'txn-1');
    expect(service.findOne).toHaveBeenCalledWith('hh-1', 'txn-1');
  });

  it('update delegates the patch', async () => {
    const dto = { amountCents: 200 };
    await controller.update(mockReq, 'txn-1', dto);
    expect(service.update).toHaveBeenCalledWith('hh-1', 'txn-1', dto);
  });

  it('remove delegates scoped to the household', async () => {
    await controller.remove(mockReq, 'txn-1');
    expect(service.remove).toHaveBeenCalledWith('hh-1', 'txn-1');
  });
});
