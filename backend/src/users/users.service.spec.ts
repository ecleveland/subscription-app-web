import { Test, TestingModule } from '@nestjs/testing';
import {
  ConflictException,
  NotFoundException,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import * as bcrypt from 'bcryptjs';
import { UsersService } from './users.service';
import { User, UserRole } from './schemas/user.schema';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { RefreshToken } from '../auth/schemas/refresh-token.schema';

jest.mock('bcryptjs');

function createChainable(resolvedValue: any = null) {
  const chain: any = {};
  chain.select = jest.fn().mockReturnValue(chain);
  chain.exec = jest.fn().mockResolvedValue(resolvedValue);
  return chain;
}

describe('UsersService', () => {
  let service: UsersService;
  let mockUserModel: any;
  let mockRefreshTokenModel: any;
  let mockSubscriptionsService: { removeAllByUserId: jest.Mock };

  const mockUser = {
    _id: '507f1f77bcf86cd799439011',
    username: 'testuser',
    passwordHash: 'hashed-password',
    displayName: 'Test User',
    email: 'test@example.com',
    role: UserRole.USER,
    save: jest.fn(),
  };

  beforeEach(async () => {
    mockSubscriptionsService = {
      removeAllByUserId: jest.fn().mockResolvedValue(0),
    };

    mockUserModel = jest.fn().mockImplementation((dto) => ({
      ...dto,
      save: jest.fn().mockResolvedValue({ _id: 'new-id', ...dto }),
    }));
    mockUserModel.find = jest.fn().mockReturnValue(createChainable([]));
    mockUserModel.findById = jest.fn().mockReturnValue(createChainable(null));
    mockUserModel.findOne = jest.fn().mockReturnValue(createChainable(null));
    mockUserModel.findByIdAndUpdate = jest
      .fn()
      .mockReturnValue(createChainable(null));
    mockUserModel.findByIdAndDelete = jest
      .fn()
      .mockReturnValue(createChainable(null));
    mockUserModel.countDocuments = jest
      .fn()
      .mockReturnValue(createChainable(0));

    mockRefreshTokenModel = {
      updateMany: jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue({ modifiedCount: 0 }),
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: getModelToken(User.name), useValue: mockUserModel },
        {
          provide: getModelToken(RefreshToken.name),
          useValue: mockRefreshTokenModel,
        },
        { provide: SubscriptionsService, useValue: mockSubscriptionsService },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('create', () => {
    it('should hash the password, save the user, and log', async () => {
      (bcrypt.hash as jest.Mock).mockResolvedValue('bcrypt-hash');
      const saveMock = jest.fn().mockResolvedValue({
        _id: { toString: () => 'new-id' },
        username: 'newuser',
        passwordHash: 'bcrypt-hash',
        role: UserRole.USER,
      });
      mockUserModel.mockImplementation((dto: any) => ({
        ...dto,
        save: saveMock,
      }));
      const logSpy = jest.spyOn(Logger.prototype, 'log');

      const result = await service.create({
        username: 'newuser',
        password: 'mypassword',
      });

      expect(bcrypt.hash).toHaveBeenCalledWith('mypassword', 10);
      expect(mockUserModel).toHaveBeenCalledWith(
        expect.objectContaining({
          username: 'newuser',
          passwordHash: 'bcrypt-hash',
          role: UserRole.USER,
        }),
      );
      expect(saveMock).toHaveBeenCalled();
      expect(result).toBeDefined();
      expect(logSpy).toHaveBeenCalledWith(
        { userId: 'new-id', username: 'newuser' },
        'User created',
      );
    });

    it('should assign the provided role when specified', async () => {
      (bcrypt.hash as jest.Mock).mockResolvedValue('bcrypt-hash');
      mockUserModel.mockImplementation((dto: any) => ({
        ...dto,
        save: jest.fn().mockResolvedValue({ _id: 'new-id', ...dto }),
      }));

      await service.create({
        username: 'admin',
        password: 'mypassword',
        role: UserRole.ADMIN,
      });

      expect(mockUserModel).toHaveBeenCalledWith(
        expect.objectContaining({ role: UserRole.ADMIN }),
      );
    });

    it('should throw ConflictException on duplicate key error (code 11000)', async () => {
      (bcrypt.hash as jest.Mock).mockResolvedValue('bcrypt-hash');
      const error = new Error('Duplicate') as Error & { code: number };
      error.code = 11000;
      mockUserModel.mockImplementation(() => ({
        save: jest.fn().mockRejectedValue(error),
      }));

      await expect(
        service.create({ username: 'dup', password: 'password123' }),
      ).rejects.toThrow(ConflictException);
    });

    it('should re-throw non-duplicate errors', async () => {
      (bcrypt.hash as jest.Mock).mockResolvedValue('bcrypt-hash');
      const error = new Error('Something else');
      mockUserModel.mockImplementation(() => ({
        save: jest.fn().mockRejectedValue(error),
      }));

      await expect(
        service.create({ username: 'test', password: 'password123' }),
      ).rejects.toThrow('Something else');
    });
  });

  describe('findAll', () => {
    it('should return users excluding passwordHash', async () => {
      const chain = createChainable([mockUser]);
      mockUserModel.find.mockReturnValue(chain);

      const result = await service.findAll();

      expect(mockUserModel.find).toHaveBeenCalled();
      expect(chain.select).toHaveBeenCalledWith('-passwordHash');
      expect(result).toEqual([mockUser]);
    });
  });

  describe('findOne', () => {
    it('should return a user by id', async () => {
      mockUserModel.findById.mockReturnValue(createChainable(mockUser));

      const result = await service.findOne('507f1f77bcf86cd799439011');

      expect(mockUserModel.findById).toHaveBeenCalledWith(
        '507f1f77bcf86cd799439011',
      );
      expect(result).toEqual(mockUser);
    });

    it('should throw NotFoundException when user is not found', async () => {
      mockUserModel.findById.mockReturnValue(createChainable(null));

      await expect(service.findOne('nonexistent')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('findOnePublic', () => {
    it('should return a user excluding passwordHash', async () => {
      const chain = createChainable(mockUser);
      mockUserModel.findById.mockReturnValue(chain);

      const result = await service.findOnePublic('507f1f77bcf86cd799439011');

      expect(chain.select).toHaveBeenCalledWith('-passwordHash');
      expect(result).toEqual(mockUser);
    });

    it('should throw NotFoundException when user is not found', async () => {
      const chain = createChainable(null);
      mockUserModel.findById.mockReturnValue(chain);

      await expect(service.findOnePublic('nonexistent')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('findByUsername', () => {
    it('should find user by lowercased username', async () => {
      mockUserModel.findOne.mockReturnValue(createChainable(mockUser));

      const result = await service.findByUsername('TestUser');

      expect(mockUserModel.findOne).toHaveBeenCalledWith({
        username: 'testuser',
      });
      expect(result).toEqual(mockUser);
    });

    it('should return null when user is not found', async () => {
      mockUserModel.findOne.mockReturnValue(createChainable(null));

      const result = await service.findByUsername('nobody');

      expect(result).toBeNull();
    });
  });

  describe('findByEmail', () => {
    it('should find user by lowercased email', async () => {
      mockUserModel.findOne.mockReturnValue(createChainable(mockUser));

      const result = await service.findByEmail('Test@Example.com');

      expect(mockUserModel.findOne).toHaveBeenCalledWith({
        email: 'test@example.com',
      });
      expect(result).toEqual(mockUser);
    });

    it('should return null when user is not found', async () => {
      mockUserModel.findOne.mockReturnValue(createChainable(null));

      const result = await service.findByEmail('nobody@example.com');

      expect(result).toBeNull();
    });
  });

  describe('update', () => {
    it('should update and return the user excluding passwordHash', async () => {
      const updatedUser = { ...mockUser, displayName: 'Updated' };
      const chain = createChainable(updatedUser);
      mockUserModel.findByIdAndUpdate.mockReturnValue(chain);

      const result = await service.update('507f1f77bcf86cd799439011', {
        displayName: 'Updated',
      });

      expect(mockUserModel.findByIdAndUpdate).toHaveBeenCalledWith(
        '507f1f77bcf86cd799439011',
        { displayName: 'Updated' },
        { new: true, runValidators: true },
      );
      expect(chain.select).toHaveBeenCalledWith('-passwordHash');
      expect(result).toEqual(updatedUser);
    });

    it('should throw NotFoundException when user is not found', async () => {
      mockUserModel.findByIdAndUpdate.mockReturnValue(createChainable(null));

      await expect(
        service.update('nonexistent', { displayName: 'X' }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('changePassword', () => {
    it('should hash new password, save, and log when current password is valid', async () => {
      const userDoc = {
        ...mockUser,
        save: jest.fn().mockResolvedValue(undefined),
      };
      mockUserModel.findById.mockReturnValue(createChainable(userDoc));
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      (bcrypt.hash as jest.Mock).mockResolvedValue('new-hash');
      const logSpy = jest.spyOn(Logger.prototype, 'log');

      await service.changePassword('507f1f77bcf86cd799439011', 'old', 'new');

      expect(bcrypt.compare).toHaveBeenCalledWith('old', 'hashed-password');
      expect(bcrypt.hash).toHaveBeenCalledWith('new', 10);
      expect(userDoc.passwordHash).toBe('new-hash');
      expect(userDoc.save).toHaveBeenCalled();
      expect(logSpy).toHaveBeenCalledWith(
        { userId: '507f1f77bcf86cd799439011' },
        'Password changed',
      );
    });

    it('should revoke all refresh tokens after password change', async () => {
      const userDoc = {
        ...mockUser,
        save: jest.fn().mockResolvedValue(undefined),
      };
      mockUserModel.findById.mockReturnValue(createChainable(userDoc));
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      (bcrypt.hash as jest.Mock).mockResolvedValue('new-hash');

      await service.changePassword('507f1f77bcf86cd799439011', 'old', 'new');

      expect(mockRefreshTokenModel.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: expect.anything(),
          revokedAt: { $exists: false },
        }),
        expect.objectContaining({ revokedAt: expect.any(Date) }),
      );
    });

    it('should throw UnauthorizedException when current password is wrong', async () => {
      mockUserModel.findById.mockReturnValue(createChainable(mockUser));
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      await expect(
        service.changePassword('507f1f77bcf86cd799439011', 'wrong', 'new'),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('remove', () => {
    it('should delete user, cascade-delete their subscriptions, and log', async () => {
      mockUserModel.findByIdAndDelete.mockReturnValue(
        createChainable(mockUser),
      );
      mockSubscriptionsService.removeAllByUserId.mockResolvedValue(5);
      const logSpy = jest.spyOn(Logger.prototype, 'log');

      await service.remove('507f1f77bcf86cd799439011');

      expect(mockUserModel.findByIdAndDelete).toHaveBeenCalledWith(
        '507f1f77bcf86cd799439011',
      );
      expect(mockSubscriptionsService.removeAllByUserId).toHaveBeenCalledWith(
        '507f1f77bcf86cd799439011',
      );
      expect(logSpy).toHaveBeenCalledWith(
        { userId: '507f1f77bcf86cd799439011' },
        'User deleted',
      );
    });

    it('should throw NotFoundException and not delete subscriptions when user is not found', async () => {
      mockUserModel.findByIdAndDelete.mockReturnValue(createChainable(null));

      await expect(service.remove('nonexistent')).rejects.toThrow(
        NotFoundException,
      );
      expect(mockSubscriptionsService.removeAllByUserId).not.toHaveBeenCalled();
    });

    it('should succeed even when user has no subscriptions', async () => {
      mockUserModel.findByIdAndDelete.mockReturnValue(
        createChainable(mockUser),
      );
      mockSubscriptionsService.removeAllByUserId.mockResolvedValue(0);

      await service.remove('507f1f77bcf86cd799439011');

      expect(mockSubscriptionsService.removeAllByUserId).toHaveBeenCalledWith(
        '507f1f77bcf86cd799439011',
      );
    });
  });

  describe('countAdmins', () => {
    it('should count documents with admin role', async () => {
      mockUserModel.countDocuments.mockReturnValue(createChainable(2));

      const result = await service.countAdmins();

      expect(mockUserModel.countDocuments).toHaveBeenCalledWith({
        role: UserRole.ADMIN,
      });
      expect(result).toBe(2);
    });
  });

  describe('seedAdmin', () => {
    it('should create admin when no admins exist and passwordHash is provided and log', async () => {
      mockUserModel.countDocuments.mockReturnValue(createChainable(0));
      mockUserModel.findOne.mockReturnValue(createChainable(null));
      const saveMock = jest.fn().mockResolvedValue(undefined);
      mockUserModel.mockImplementation((dto: any) => ({
        ...dto,
        save: saveMock,
      }));
      const logSpy = jest.spyOn(Logger.prototype, 'log');

      await service.seedAdmin('admin', 'pre-hashed');

      expect(mockUserModel).toHaveBeenCalledWith(
        expect.objectContaining({
          username: 'admin',
          passwordHash: 'pre-hashed',
          role: UserRole.ADMIN,
        }),
      );
      expect(saveMock).toHaveBeenCalled();
      expect(logSpy).toHaveBeenCalledWith(
        { username: 'admin' },
        'Seeded admin user',
      );
    });

    it('should skip seeding when admins already exist', async () => {
      mockUserModel.countDocuments.mockReturnValue(createChainable(1));

      await service.seedAdmin('admin', 'pre-hashed');

      expect(mockUserModel).not.toHaveBeenCalledWith(
        expect.objectContaining({ role: UserRole.ADMIN }),
      );
    });

    it('should skip seeding when passwordHash is empty', async () => {
      mockUserModel.countDocuments.mockReturnValue(createChainable(0));

      await service.seedAdmin('admin', '');

      expect(mockUserModel.findOne).not.toHaveBeenCalled();
    });

    it('should skip seeding when username already exists', async () => {
      mockUserModel.countDocuments.mockReturnValue(createChainable(0));
      mockUserModel.findOne.mockReturnValue(createChainable(mockUser));

      await service.seedAdmin('testuser', 'pre-hashed');

      // Model constructor should not be called to create a new admin
      expect(mockUserModel).not.toHaveBeenCalledWith(
        expect.objectContaining({ role: UserRole.ADMIN }),
      );
    });
  });
});
