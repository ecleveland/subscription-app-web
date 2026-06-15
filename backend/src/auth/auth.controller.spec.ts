import { Test, TestingModule } from '@nestjs/testing';
import { Logger, UnauthorizedException } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { UsersService } from '../users/users.service';

function mockRes(): {
  res: Response;
  cookie: jest.Mock;
  clearCookie: jest.Mock;
} {
  const cookie = jest.fn();
  const clearCookie = jest.fn();
  return {
    res: { cookie, clearCookie } as unknown as Response,
    cookie,
    clearCookie,
  };
}

describe('AuthController', () => {
  let controller: AuthController;
  let authService: jest.Mocked<
    Pick<AuthService, 'login' | 'refresh' | 'logout'>
  >;
  let usersService: jest.Mocked<Pick<UsersService, 'create'>>;

  beforeEach(async () => {
    authService = {
      login: jest.fn().mockResolvedValue({
        access_token: 'jwt-token',
        refresh_token: 'refresh-token',
      }),
      refresh: jest.fn().mockResolvedValue({
        access_token: 'new-jwt-token',
        refresh_token: 'new-refresh-token',
      }),
      logout: jest.fn().mockResolvedValue(undefined),
    };
    usersService = {
      create: jest
        .fn()
        .mockResolvedValue({ _id: 'new-id', username: 'newuser' }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        { provide: AuthService, useValue: authService },
        { provide: UsersService, useValue: usersService },
      ],
    })
      .overrideGuard(ThrottlerGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<AuthController>(AuthController);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('login', () => {
    it('returns only the access token and sets the refresh cookie', async () => {
      const { res, cookie } = mockRes();
      const result = await controller.login(
        { username: 'testuser', password: 'password' },
        res,
      );

      expect(authService.login).toHaveBeenCalledWith('testuser', 'password');
      expect(result).toEqual({ access_token: 'jwt-token' });
      expect(cookie).toHaveBeenCalledWith(
        'refresh_token',
        'refresh-token',
        expect.objectContaining({ httpOnly: true }),
      );
    });
  });

  describe('register', () => {
    it('creates the user, logs in, and sets the refresh cookie', async () => {
      const { res, cookie } = mockRes();
      const logSpy = jest.spyOn(Logger.prototype, 'log');
      const result = await controller.register(
        {
          username: 'newuser',
          password: 'Password123',
          displayName: 'New User',
          email: 'new@example.com',
        },
        res,
      );

      expect(usersService.create).toHaveBeenCalledWith({
        username: 'newuser',
        password: 'Password123',
        displayName: 'New User',
        email: 'new@example.com',
      });
      expect(authService.login).toHaveBeenCalledWith('newuser', 'Password123');
      expect(result).toEqual({ access_token: 'jwt-token' });
      expect(cookie).toHaveBeenCalled();
      expect(logSpy).toHaveBeenCalledWith(
        { username: 'newuser' },
        'User registered',
      );
    });

    it('passes undefined for optional fields when not provided', async () => {
      await controller.register(
        { username: 'minimal', password: 'Password123' },
        mockRes().res,
      );

      expect(usersService.create).toHaveBeenCalledWith({
        username: 'minimal',
        password: 'Password123',
        displayName: undefined,
        email: undefined,
      });
    });
  });

  describe('refresh', () => {
    it('reads the refresh token from the cookie and rotates it', async () => {
      const { res, cookie } = mockRes();
      const req = {
        cookies: { refresh_token: 'some-refresh-token' },
      } as unknown as Request;

      const result = await controller.refresh(req, res);

      expect(authService.refresh).toHaveBeenCalledWith('some-refresh-token');
      expect(result).toEqual({ access_token: 'new-jwt-token' });
      expect(cookie).toHaveBeenCalledWith(
        'refresh_token',
        'new-refresh-token',
        expect.objectContaining({ httpOnly: true }),
      );
    });

    it('throws 401 when the refresh cookie is missing', async () => {
      const req = { cookies: {} } as unknown as Request;

      await expect(controller.refresh(req, mockRes().res)).rejects.toThrow(
        UnauthorizedException,
      );
      expect(authService.refresh).not.toHaveBeenCalled();
    });
  });

  describe('logout', () => {
    it('revokes the cookie refresh token and clears the cookie', async () => {
      const { res, clearCookie } = mockRes();
      const req = {
        user: { userId: 'user-123', username: 'test', role: 'user' },
        cookies: { refresh_token: 'token-to-revoke' },
      } as unknown as Request & {
        user: { userId: string; username: string; role: string };
      };

      await controller.logout(req, res);

      expect(authService.logout).toHaveBeenCalledWith(
        'user-123',
        'token-to-revoke',
      );
      expect(clearCookie).toHaveBeenCalledWith(
        'refresh_token',
        expect.any(Object),
      );
    });

    it('still clears the cookie when no refresh token is present', async () => {
      const { res, clearCookie } = mockRes();
      const req = {
        user: { userId: 'user-123', username: 'test', role: 'user' },
        cookies: {},
      } as unknown as Request & {
        user: { userId: string; username: string; role: string };
      };

      await controller.logout(req, res);

      expect(authService.logout).not.toHaveBeenCalled();
      expect(clearCookie).toHaveBeenCalled();
    });
  });
});
