import { Test, TestingModule } from '@nestjs/testing';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

describe('UsersController', () => {
  let controller: UsersController;
  let usersService: jest.Mocked<
    Pick<UsersService, 'findOnePublic' | 'update' | 'changePassword'>
  >;

  const mockReq = {
    user: { userId: 'user-id-123', username: 'testuser', role: 'user' },
  } as any;

  const mockUser = {
    _id: 'user-id-123',
    username: 'testuser',
    displayName: 'Test User',
  };

  beforeEach(async () => {
    usersService = {
      findOnePublic: jest.fn().mockResolvedValue(mockUser),
      update: jest.fn().mockResolvedValue({ ...mockUser, displayName: 'Updated' }),
      changePassword: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [{ provide: UsersService, useValue: usersService }],
    }).compile();

    controller = module.get<UsersController>(UsersController);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getProfile', () => {
    it('should call findOnePublic with userId from request', async () => {
      const result = await controller.getProfile(mockReq);

      expect(usersService.findOnePublic).toHaveBeenCalledWith('user-id-123');
      expect(result).toEqual(mockUser);
    });
  });

  describe('updateProfile', () => {
    it('should call update with userId and dto', async () => {
      const dto = { displayName: 'Updated' };
      const result = await controller.updateProfile(mockReq, dto);

      expect(usersService.update).toHaveBeenCalledWith('user-id-123', dto);
      expect(result.displayName).toBe('Updated');
    });
  });

  describe('changePassword', () => {
    it('should call changePassword with userId, currentPassword, and newPassword', async () => {
      const dto = { currentPassword: 'old', newPassword: 'newpass123' };
      await controller.changePassword(mockReq, dto);

      expect(usersService.changePassword).toHaveBeenCalledWith(
        'user-id-123',
        'old',
        'newpass123',
      );
    });
  });
});
