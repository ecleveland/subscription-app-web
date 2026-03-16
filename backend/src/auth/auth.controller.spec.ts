import { Test, TestingModule } from '@nestjs/testing';
import { Logger } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { UsersService } from '../users/users.service';

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
    it('should delegate to authService.login with username and password', async () => {
      const result = await controller.login({
        username: 'testuser',
        password: 'password',
      });

      expect(authService.login).toHaveBeenCalledWith('testuser', 'password');
      expect(result).toEqual({
        access_token: 'jwt-token',
        refresh_token: 'refresh-token',
      });
    });
  });

  describe('register', () => {
    it('should create user then login with the same credentials and log registration', async () => {
      const logSpy = jest.spyOn(Logger.prototype, 'log');
      const result = await controller.register({
        username: 'newuser',
        password: 'password123',
        displayName: 'New User',
        email: 'new@example.com',
      });

      expect(usersService.create).toHaveBeenCalledWith({
        username: 'newuser',
        password: 'password123',
        displayName: 'New User',
        email: 'new@example.com',
      });
      expect(authService.login).toHaveBeenCalledWith('newuser', 'password123');
      expect(result).toEqual({
        access_token: 'jwt-token',
        refresh_token: 'refresh-token',
      });
      expect(logSpy).toHaveBeenCalledWith(
        { username: 'newuser' },
        'User registered',
      );
    });

    it('should pass undefined for optional fields when not provided', async () => {
      await controller.register({
        username: 'minimal',
        password: 'password123',
      });

      expect(usersService.create).toHaveBeenCalledWith({
        username: 'minimal',
        password: 'password123',
        displayName: undefined,
        email: undefined,
      });
    });
  });

  describe('refresh', () => {
    it('should delegate to authService.refresh', async () => {
      const result = await controller.refresh({
        refresh_token: 'some-refresh-token',
      });

      expect(authService.refresh).toHaveBeenCalledWith('some-refresh-token');
      expect(result).toEqual({
        access_token: 'new-jwt-token',
        refresh_token: 'new-refresh-token',
      });
    });
  });

  describe('logout', () => {
    it('should delegate to authService.logout with userId and refresh token', async () => {
      const req = {
        user: { userId: 'user-123', username: 'test', role: 'user' },
      } as any;

      await controller.logout(req, { refresh_token: 'token-to-revoke' });

      expect(authService.logout).toHaveBeenCalledWith(
        'user-123',
        'token-to-revoke',
      );
    });
  });
});
