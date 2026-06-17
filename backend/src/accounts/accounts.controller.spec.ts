import { Test, TestingModule } from '@nestjs/testing';
import { AccountsController } from './accounts.controller';
import { AccountsService } from './accounts.service';
import { AccountType } from './schemas/account.schema';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { HouseholdGuard } from '../households/guards/household.guard';

describe('AccountsController', () => {
  let controller: AccountsController;
  let service: jest.Mocked<
    Pick<
      AccountsService,
      'create' | 'findAll' | 'findOne' | 'update' | 'archive'
    >
  >;

  const mockReq = {
    user: { userId: 'user-id-123', username: 'testuser', role: 'user' },
    household: {
      householdId: 'household-id-1',
      memberId: 'member-id-1',
      role: 'owner',
    },
  } as any;

  const mockAccount = {
    _id: 'acct-id-1',
    name: 'Everyday Checking',
    type: AccountType.CHECKING,
    balanceCents: 125000,
    isArchived: false,
  };

  beforeEach(async () => {
    service = {
      create: jest.fn().mockResolvedValue(mockAccount),
      findAll: jest.fn().mockResolvedValue([mockAccount]),
      findOne: jest.fn().mockResolvedValue(mockAccount),
      update: jest.fn().mockResolvedValue({ ...mockAccount, name: 'Renamed' }),
      archive: jest
        .fn()
        .mockResolvedValue({ ...mockAccount, isArchived: true }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AccountsController],
      providers: [{ provide: AccountsService, useValue: service }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(HouseholdGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<AccountsController>(AccountsController);
  });

  it('create delegates to the service with the household id', async () => {
    const dto = { name: 'Everyday Checking', type: AccountType.CHECKING };
    await controller.create(mockReq, dto);
    expect(service.create).toHaveBeenCalledWith('household-id-1', dto);
  });

  it('findAll defaults includeArchived to false', async () => {
    await controller.findAll(mockReq, {});
    expect(service.findAll).toHaveBeenCalledWith('household-id-1', false);
  });

  it('findAll forwards includeArchived when set', async () => {
    await controller.findAll(mockReq, { includeArchived: true });
    expect(service.findAll).toHaveBeenCalledWith('household-id-1', true);
  });

  it('findOne delegates to the service scoped to the household', async () => {
    await controller.findOne(mockReq, 'acct-id-1');
    expect(service.findOne).toHaveBeenCalledWith('household-id-1', 'acct-id-1');
  });

  it('update delegates the patch to the service', async () => {
    const dto = { name: 'Renamed' };
    await controller.update(mockReq, 'acct-id-1', dto);
    expect(service.update).toHaveBeenCalledWith(
      'household-id-1',
      'acct-id-1',
      dto,
    );
  });

  it('remove soft-archives via the service (never hard-deletes)', async () => {
    const result = await controller.remove(mockReq, 'acct-id-1');
    expect(service.archive).toHaveBeenCalledWith('household-id-1', 'acct-id-1');
    expect(result).toBeUndefined();
  });
});
