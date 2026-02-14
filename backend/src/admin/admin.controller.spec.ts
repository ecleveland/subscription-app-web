import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { UsersService } from '../users/users.service';
import { UserRole } from '../users/schemas/user.schema';

describe('AdminController', () => {
  let controller: AdminController;
  let usersService: jest.Mocked<
    Pick<
      UsersService,
      'findAll' | 'create' | 'findOne' | 'findOnePublic' | 'update' | 'remove' | 'countAdmins'
    >
  >;

  const mockUser = {
    _id: 'user-id-1',
    username: 'testuser',
    role: UserRole.USER,
  };

  const mockAdmin = {
    _id: 'admin-id-1',
    username: 'admin',
    role: UserRole.ADMIN,
  };

  const mockReq = {
    user: { userId: 'requester-id', username: 'admin', role: 'admin' },
  } as any;

  beforeEach(async () => {
    usersService = {
      findAll: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockResolvedValue(mockUser),
      findOne: jest.fn().mockResolvedValue(mockUser),
      findOnePublic: jest.fn().mockResolvedValue(mockUser),
      update: jest.fn().mockResolvedValue(mockUser),
      remove: jest.fn().mockResolvedValue(undefined),
      countAdmins: jest.fn().mockResolvedValue(2),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AdminController],
      providers: [{ provide: UsersService, useValue: usersService }],
    }).compile();

    controller = module.get<AdminController>(AdminController);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('findAll', () => {
    it('should delegate to usersService.findAll', async () => {
      await controller.findAll();
      expect(usersService.findAll).toHaveBeenCalled();
    });
  });

  describe('create', () => {
    it('should delegate to usersService.create', async () => {
      const dto = { username: 'new', password: 'password123' };
      await controller.create(dto);
      expect(usersService.create).toHaveBeenCalledWith(dto);
    });
  });

  describe('findOne', () => {
    it('should delegate to usersService.findOnePublic', async () => {
      await controller.findOne('user-id-1');
      expect(usersService.findOnePublic).toHaveBeenCalledWith('user-id-1');
    });
  });

  describe('update', () => {
    it('should allow non-role updates without checking admin count', async () => {
      await controller.update('user-id-1', { displayName: 'New Name' });

      expect(usersService.countAdmins).not.toHaveBeenCalled();
      expect(usersService.update).toHaveBeenCalledWith('user-id-1', {
        displayName: 'New Name',
      });
    });

    it('should allow role change when target is not an admin', async () => {
      usersService.findOne.mockResolvedValue({
        ...mockUser,
        role: UserRole.USER,
      } as any);

      await controller.update('user-id-1', { role: UserRole.ADMIN });

      // findOne is called but countAdmins is not because target is not admin
      expect(usersService.update).toHaveBeenCalled();
    });

    it('should allow demoting admin when multiple admins exist', async () => {
      usersService.findOne.mockResolvedValue(mockAdmin as any);
      usersService.countAdmins.mockResolvedValue(2);

      await controller.update('admin-id-1', { role: UserRole.USER });

      expect(usersService.countAdmins).toHaveBeenCalled();
      expect(usersService.update).toHaveBeenCalledWith('admin-id-1', {
        role: UserRole.USER,
      });
    });

    it('should throw ForbiddenException when demoting the last admin', async () => {
      usersService.findOne.mockResolvedValue(mockAdmin as any);
      usersService.countAdmins.mockResolvedValue(1);

      await expect(
        controller.update('admin-id-1', { role: UserRole.USER }),
      ).rejects.toThrow(ForbiddenException);
      expect(usersService.update).not.toHaveBeenCalled();
    });

    it('should not check admin count when setting role to admin', async () => {
      await controller.update('user-id-1', { role: UserRole.ADMIN });

      // No ForbiddenException concern when promoting to admin
      expect(usersService.countAdmins).not.toHaveBeenCalled();
      expect(usersService.update).toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('should throw ForbiddenException when deleting self', async () => {
      const reqSelf = {
        user: { userId: 'user-id-1', username: 'admin', role: 'admin' },
      } as any;

      await expect(controller.remove(reqSelf, 'user-id-1')).rejects.toThrow(
        ForbiddenException,
      );
      expect(usersService.remove).not.toHaveBeenCalled();
    });

    it('should throw ForbiddenException when deleting the last admin', async () => {
      usersService.findOne.mockResolvedValue(mockAdmin as any);
      usersService.countAdmins.mockResolvedValue(1);

      await expect(
        controller.remove(mockReq, 'admin-id-1'),
      ).rejects.toThrow(ForbiddenException);
      expect(usersService.remove).not.toHaveBeenCalled();
    });

    it('should allow deleting an admin when multiple admins exist', async () => {
      usersService.findOne.mockResolvedValue(mockAdmin as any);
      usersService.countAdmins.mockResolvedValue(2);

      await controller.remove(mockReq, 'admin-id-1');

      expect(usersService.remove).toHaveBeenCalledWith('admin-id-1');
    });

    it('should allow deleting a non-admin user', async () => {
      usersService.findOne.mockResolvedValue({
        ...mockUser,
        role: UserRole.USER,
      } as any);

      await controller.remove(mockReq, 'user-id-1');

      expect(usersService.countAdmins).not.toHaveBeenCalled();
      expect(usersService.remove).toHaveBeenCalledWith('user-id-1');
    });
  });
});
