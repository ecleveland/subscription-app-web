import { Test, TestingModule } from '@nestjs/testing';
import { UnauthorizedException, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { getModelToken } from '@nestjs/mongoose';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';
import { AuthService } from './auth.service';
import { UsersService } from '../users/users.service';
import { PasswordReset } from './schemas/password-reset.schema';
import { MAIL_SERVICE } from '../mail/mail.service';

jest.mock('bcryptjs');

describe('AuthService', () => {
  let service: AuthService;
  let usersService: jest.Mocked<
    Pick<UsersService, 'findByUsername' | 'findByEmail'>
  >;
  let jwtService: jest.Mocked<Pick<JwtService, 'sign'>>;
  let mailService: { sendPasswordResetEmail: jest.Mock };
  let mockPasswordResetModel: any;

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
        { provide: MAIL_SERVICE, useValue: mailService },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('login', () => {
    it('should return an access token for valid credentials', async () => {
      usersService.findByUsername.mockResolvedValue(mockUser as any);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      const result = await service.login('testuser', 'password');

      expect(result).toEqual({ access_token: 'signed-jwt-token' });
      expect(usersService.findByUsername).toHaveBeenCalledWith('testuser');
      expect(bcrypt.compare).toHaveBeenCalledWith(
        'password',
        'hashed-password',
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

    it('should throw UnauthorizedException when user is not found', async () => {
      usersService.findByUsername.mockResolvedValue(null);

      await expect(service.login('unknown', 'password')).rejects.toThrow(
        UnauthorizedException,
      );
      expect(bcrypt.compare).not.toHaveBeenCalled();
    });

    it('should throw UnauthorizedException when password is incorrect', async () => {
      usersService.findByUsername.mockResolvedValue(mockUser as any);
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      await expect(service.login('testuser', 'wrong')).rejects.toThrow(
        UnauthorizedException,
      );
      expect(jwtService.sign).not.toHaveBeenCalled();
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

    it('should update password and mark token as used for valid token', async () => {
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
