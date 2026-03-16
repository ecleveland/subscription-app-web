import { Test, TestingModule } from '@nestjs/testing';
import { UnauthorizedException, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { getModelToken } from '@nestjs/mongoose';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';
import { Logger } from '@nestjs/common';
import { AuthService } from './auth.service';
import { UsersService } from '../users/users.service';
import { PasswordReset } from './schemas/password-reset.schema';
import { RefreshToken } from './schemas/refresh-token.schema';
import { MAIL_SERVICE } from '../mail/mail.service';

jest.mock('bcryptjs');

describe('AuthService', () => {
  let service: AuthService;
  let usersService: jest.Mocked<
    Pick<UsersService, 'findByUsername' | 'findByEmail' | 'findOne'>
  >;
  let jwtService: jest.Mocked<Pick<JwtService, 'sign'>>;
  let mailService: { sendPasswordResetEmail: jest.Mock };
  let mockPasswordResetModel: any;
  let mockRefreshTokenModel: any;

  const mockUser = {
    _id: { toString: () => '507f1f77bcf86cd799439011' },
    username: 'testuser',
    email: 'test@example.com',
    passwordHash: 'hashed-password',
    role: 'user',
    save: jest.fn(),
  };

  beforeEach(async () => {
    usersService = {
      findByUsername: jest.fn(),
      findByEmail: jest.fn(),
      findOne: jest.fn(),
    };
    jwtService = {
      sign: jest.fn().mockReturnValue('signed-jwt-token'),
    };
    mailService = {
      sendPasswordResetEmail: jest.fn().mockResolvedValue(undefined),
    };

    const saveMock = jest.fn().mockResolvedValue(undefined);
    mockPasswordResetModel = jest.fn().mockImplementation(() => ({
      save: saveMock,
    }));
    mockPasswordResetModel.findOne = jest.fn().mockReturnValue({
      exec: jest.fn().mockResolvedValue(null),
    });

    const refreshSaveMock = jest.fn().mockResolvedValue(undefined);
    mockRefreshTokenModel = jest.fn().mockImplementation(() => ({
      save: refreshSaveMock,
    }));
    mockRefreshTokenModel.findOne = jest.fn().mockReturnValue({
      exec: jest.fn().mockResolvedValue(null),
    });
    mockRefreshTokenModel.findOneAndUpdate = jest.fn().mockReturnValue({
      exec: jest.fn().mockResolvedValue(null),
    });
    mockRefreshTokenModel.updateMany = jest.fn().mockReturnValue({
      exec: jest.fn().mockResolvedValue({ modifiedCount: 0 }),
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: UsersService, useValue: usersService },
        { provide: JwtService, useValue: jwtService },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn().mockReturnValue('http://localhost:3000'),
          },
        },
        {
          provide: getModelToken(PasswordReset.name),
          useValue: mockPasswordResetModel,
        },
        {
          provide: getModelToken(RefreshToken.name),
          useValue: mockRefreshTokenModel,
        },
        { provide: MAIL_SERVICE, useValue: mailService },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('login', () => {
    it('should return access_token and refresh_token for valid credentials', async () => {
      usersService.findByUsername.mockResolvedValue(mockUser as any);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      const logSpy = jest.spyOn(Logger.prototype, 'log');

      const result = await service.login('testuser', 'password');

      expect(result.access_token).toBe('signed-jwt-token');
      expect(result.refresh_token).toBeDefined();
      expect(typeof result.refresh_token).toBe('string');
      expect(usersService.findByUsername).toHaveBeenCalledWith('testuser');
      expect(bcrypt.compare).toHaveBeenCalledWith(
        'password',
        'hashed-password',
      );
      expect(logSpy).toHaveBeenCalledWith(
        expect.objectContaining({ username: 'testuser' }),
        'Login successful',
      );
    });

    it('should sign JWT with correct payload shape', async () => {
      usersService.findByUsername.mockResolvedValue(mockUser as any);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      await service.login('testuser', 'password');

      expect(jwtService.sign).toHaveBeenCalledWith({
        sub: '507f1f77bcf86cd799439011',
        username: 'testuser',
        role: 'user',
      });
    });

    it('should store refresh token hash in database', async () => {
      usersService.findByUsername.mockResolvedValue(mockUser as any);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      await service.login('testuser', 'password');

      expect(mockRefreshTokenModel).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: expect.anything(),
          tokenHash: expect.any(String),
          expiresAt: expect.any(Date),
        }),
      );
    });

    it('should throw UnauthorizedException and warn when user is not found', async () => {
      usersService.findByUsername.mockResolvedValue(null);
      const warnSpy = jest.spyOn(Logger.prototype, 'warn');

      await expect(service.login('unknown', 'password')).rejects.toThrow(
        UnauthorizedException,
      );
      expect(bcrypt.compare).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledWith(
        expect.objectContaining({ username: 'unknown' }),
        'Login failed: user not found',
      );
    });

    it('should throw UnauthorizedException and warn when password is incorrect', async () => {
      usersService.findByUsername.mockResolvedValue(mockUser as any);
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);
      const warnSpy = jest.spyOn(Logger.prototype, 'warn');

      await expect(service.login('testuser', 'wrong')).rejects.toThrow(
        UnauthorizedException,
      );
      expect(jwtService.sign).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledWith(
        expect.objectContaining({ username: 'testuser' }),
        'Login failed: invalid password',
      );
    });
  });

  describe('refresh', () => {
    it('should revoke old token and return new pair for valid refresh token', async () => {
      const plainToken = crypto.randomBytes(32).toString('hex');
      const tokenDoc = {
        userId: { toString: () => '507f1f77bcf86cd799439011' },
        tokenHash: crypto.createHash('sha256').update(plainToken).digest('hex'),
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        save: jest.fn().mockResolvedValue(undefined),
      };
      mockRefreshTokenModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue(tokenDoc),
      });
      usersService.findOne.mockResolvedValue(mockUser as any);

      const result = await service.refresh(plainToken);

      expect(result.access_token).toBe('signed-jwt-token');
      expect(result.refresh_token).toBeDefined();
      expect(tokenDoc.revokedAt).toBeInstanceOf(Date);
      expect(tokenDoc.save).toHaveBeenCalled();
    });

    it('should throw UnauthorizedException for expired/revoked token', async () => {
      mockRefreshTokenModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue(null),
      });

      await expect(service.refresh('invalid-token')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should throw UnauthorizedException when user no longer exists', async () => {
      const plainToken = crypto.randomBytes(32).toString('hex');
      const tokenDoc = {
        userId: { toString: () => '507f1f77bcf86cd799439011' },
        tokenHash: crypto.createHash('sha256').update(plainToken).digest('hex'),
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        save: jest.fn(),
      };
      mockRefreshTokenModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue(tokenDoc),
      });
      usersService.findOne.mockRejectedValue(new Error('Not found'));

      await expect(service.refresh(plainToken)).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  describe('logout', () => {
    it('should revoke the specified refresh token', async () => {
      const plainToken = crypto.randomBytes(32).toString('hex');

      await service.logout('507f1f77bcf86cd799439011', plainToken);

      expect(mockRefreshTokenModel.findOneAndUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: expect.anything(),
          tokenHash: expect.any(String),
          revokedAt: { $exists: false },
        }),
        expect.objectContaining({ revokedAt: expect.any(Date) }),
      );
    });
  });

  describe('revokeAllRefreshTokens', () => {
    it('should call updateMany with userId filter', async () => {
      await service.revokeAllRefreshTokens('507f1f77bcf86cd799439011');

      expect(mockRefreshTokenModel.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: expect.anything(),
          revokedAt: { $exists: false },
        }),
        expect.objectContaining({ revokedAt: expect.any(Date) }),
      );
    });
  });

  describe('forgotPassword', () => {
    it('should generate token and call mail service when user is found', async () => {
      usersService.findByEmail.mockResolvedValue(mockUser as any);

      await service.forgotPassword('test@example.com');

      expect(usersService.findByEmail).toHaveBeenCalledWith('test@example.com');
      expect(mockPasswordResetModel).toHaveBeenCalledWith(
        expect.objectContaining({
          email: 'test@example.com',
          tokenHash: expect.any(String),
          expiresAt: expect.any(Date),
        }),
      );
      expect(mailService.sendPasswordResetEmail).toHaveBeenCalledWith(
        'test@example.com',
        expect.stringContaining('/reset-password?token='),
      );
    });

    it('should not throw or call mail when user is not found', async () => {
      usersService.findByEmail.mockResolvedValue(null);

      await expect(
        service.forgotPassword('nonexistent@example.com'),
      ).resolves.toBeUndefined();

      expect(mailService.sendPasswordResetEmail).not.toHaveBeenCalled();
      expect(mockPasswordResetModel).not.toHaveBeenCalled();
    });
  });

  describe('resetPassword', () => {
    const plainToken = 'a'.repeat(64);
    const tokenHash = crypto
      .createHash('sha256')
      .update(plainToken)
      .digest('hex');

    it('should update password, mark token as used, and revoke refresh tokens for valid token', async () => {
      const resetDoc = {
        email: 'test@example.com',
        tokenHash,
        expiresAt: new Date(Date.now() + 3600000),
        save: jest.fn().mockResolvedValue(undefined),
      };
      mockPasswordResetModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue(resetDoc),
      });
      usersService.findByEmail.mockResolvedValue(mockUser as any);
      (bcrypt.hash as jest.Mock).mockResolvedValue('new-hashed-password');

      await service.resetPassword(plainToken, 'newpassword123');

      expect(bcrypt.hash).toHaveBeenCalledWith('newpassword123', 10);
      expect(mockUser.save).toHaveBeenCalled();
      expect(mockUser.passwordHash).toBe('new-hashed-password');
      expect(resetDoc.usedAt).toBeInstanceOf(Date);
      expect(resetDoc.save).toHaveBeenCalled();
      expect(mockRefreshTokenModel.updateMany).toHaveBeenCalled();
    });

    it('should throw BadRequestException for invalid token', async () => {
      mockPasswordResetModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue(null),
      });

      await expect(
        service.resetPassword('invalid-token', 'newpassword123'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException when user no longer exists', async () => {
      const resetDoc = {
        email: 'deleted@example.com',
        tokenHash,
        expiresAt: new Date(Date.now() + 3600000),
        save: jest.fn(),
      };
      mockPasswordResetModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue(resetDoc),
      });
      usersService.findByEmail.mockResolvedValue(null);

      await expect(
        service.resetPassword(plainToken, 'newpassword123'),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
