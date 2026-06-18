import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException, Logger } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { UsersService } from '../users/users.service';
import { UserRole } from '../users/schemas/user.schema';

describe('AdminController', () => {
  let controller: AdminController;
  let usersService: jest.Mocked<
    Pick<
      UsersService,
      | 'findAll'
      | 'create'
      | 'findOne'
      | 'findOnePublic'
      | 'update'
      | 'remove'
      | 'countAdmins'
      | 'demoteAdminSafely'
    >
  >;

  const mockUser = {
    _id: 'user-id-1',
    username: 'testuser',
    role: UserRole.USER,
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
      demoteAdminSafely: jest.fn().mockResolvedValue(undefined),
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
    it('should delegate to usersService.create and log', async () => {
      usersService.create.mockResolvedValue({
        _id: { toString: () => 'new-user-id' },
        username: 'new',
      } as any);
      const logSpy = jest.spyOn(Logger.prototype, 'log');
      const dto = { username: 'new', password: 'password123' };
      await controller.create(mockReq, dto);
      expect(usersService.create).toHaveBeenCalledWith(dto);
      expect(logSpy).toHaveBeenCalledWith(
        { adminId: 'requester-id', targetUserId: 'new-user-id' },
        'Admin created user',
      );
    });
  });

  describe('findOne', () => {
    it('should delegate to usersService.findOnePublic', async () => {
      await controller.findOne('user-id-1');
      expect(usersService.findOnePublic).toHaveBeenCalledWith('user-id-1');
    });
  });

  describe('update', () => {
    it('should allow non-role updates without the admin guard and log', async () => {
      const logSpy = jest.spyOn(Logger.prototype, 'log');
      await controller.update(mockReq, 'user-id-1', {
        displayName: 'New Name',
      });

      expect(usersService.demoteAdminSafely).not.toHaveBeenCalled();
      expect(usersService.update).toHaveBeenCalledWith('user-id-1', {
        displayName: 'New Name',
      });
      expect(logSpy).toHaveBeenCalledWith(
        { adminId: 'requester-id', targetUserId: 'user-id-1' },
        'Admin updated user',
      );
    });

    it('demotes atomically via demoteAdminSafely before applying the update', async () => {
      await controller.update(mockReq, 'admin-id-1', { role: UserRole.USER });

      expect(usersService.demoteAdminSafely).toHaveBeenCalledWith('admin-id-1');
      expect(usersService.update).toHaveBeenCalledWith('admin-id-1', {
        role: UserRole.USER,
      });
    });

    it('propagates the guard error and skips the update for the last admin', async () => {
      usersService.demoteAdminSafely.mockRejectedValue(
        new ForbiddenException('Cannot remove the last admin'),
      );

      await expect(
        controller.update(mockReq, 'admin-id-1', { role: UserRole.USER }),
      ).rejects.toThrow(ForbiddenException);
      expect(usersService.update).not.toHaveBeenCalled();
    });

    it('does not run the demote guard when promoting to admin', async () => {
      await controller.update(mockReq, 'user-id-1', { role: UserRole.ADMIN });

      expect(usersService.demoteAdminSafely).not.toHaveBeenCalled();
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
      expect(usersService.demoteAdminSafely).not.toHaveBeenCalled();
      expect(usersService.remove).not.toHaveBeenCalled();
    });

    it('propagates the guard error and skips the delete for the last admin', async () => {
      usersService.demoteAdminSafely.mockRejectedValue(
        new ForbiddenException('Cannot remove the last admin'),
      );

      await expect(controller.remove(mockReq, 'admin-id-1')).rejects.toThrow(
        ForbiddenException,
      );
      expect(usersService.remove).not.toHaveBeenCalled();
    });

    it('demotes-then-deletes (guard first) and logs', async () => {
      const logSpy = jest.spyOn(Logger.prototype, 'log');

      await controller.remove(mockReq, 'admin-id-1');

      expect(usersService.demoteAdminSafely).toHaveBeenCalledWith('admin-id-1');
      expect(usersService.remove).toHaveBeenCalledWith('admin-id-1');
      expect(logSpy).toHaveBeenCalledWith(
        { adminId: 'requester-id', targetUserId: 'admin-id-1' },
        'Admin deleted user',
      );
    });

    it('restores the admin role when the delete fails after demotion', async () => {
      usersService.demoteAdminSafely.mockResolvedValue(true); // it demoted an admin
      usersService.remove.mockRejectedValue(new Error('db down'));

      await expect(controller.remove(mockReq, 'admin-id-1')).rejects.toThrow(
        'db down',
      );
      // Prior admin role restored so a failed delete doesn't silently demote.
      expect(usersService.update).toHaveBeenCalledWith('admin-id-1', {
        role: UserRole.ADMIN,
      });
    });

    it('does not re-promote a non-admin when the delete fails', async () => {
      usersService.demoteAdminSafely.mockResolvedValue(false); // target wasn't an admin
      usersService.remove.mockRejectedValue(new Error('db down'));

      await expect(controller.remove(mockReq, 'user-id-1')).rejects.toThrow(
        'db down',
      );
      expect(usersService.update).not.toHaveBeenCalled();
    });
  });
});
