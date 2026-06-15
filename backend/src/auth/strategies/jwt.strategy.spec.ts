import { NotFoundException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtStrategy } from './jwt.strategy';
import { UsersService } from '../../users/users.service';
import { JwtPayload } from '../interfaces/jwt-payload.interface';

describe('JwtStrategy', () => {
  let strategy: JwtStrategy;
  let usersService: { findOne: jest.Mock };

  const configService = {
    get: jest.fn().mockReturnValue('test-jwt-secret-at-least-32-chars-long'),
  } as unknown as ConfigService;

  const payload: JwtPayload = {
    sub: '507f1f77bcf86cd799439011',
    username: 'testuser',
    role: 'user',
    tokenVersion: 0,
  };

  beforeEach(() => {
    usersService = { findOne: jest.fn() };
    strategy = new JwtStrategy(
      configService,
      usersService as unknown as UsersService,
    );
  });

  it('returns the user with role derived from the DB (not the token)', async () => {
    usersService.findOne.mockResolvedValue({
      _id: { toString: () => payload.sub },
      username: 'testuser',
      role: 'admin', // DB says admin even though the token claims 'user'
      tokenVersion: 0,
    });

    const result = await strategy.validate(payload);

    expect(result).toEqual({
      userId: payload.sub,
      username: 'testuser',
      role: 'admin',
    });
  });

  it('rejects (401) when the user no longer exists', async () => {
    usersService.findOne.mockRejectedValue(new NotFoundException());

    await expect(strategy.validate(payload)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('propagates infrastructure errors instead of masking them as 401', async () => {
    const dbError = new Error('connection timed out');
    usersService.findOne.mockRejectedValue(dbError);

    // A transient DB failure must surface (→ 500), not log the user out.
    await expect(strategy.validate(payload)).rejects.toThrow(dbError);
    await expect(strategy.validate(payload)).rejects.not.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('rejects when the token tokenVersion is stale', async () => {
    usersService.findOne.mockResolvedValue({
      _id: { toString: () => payload.sub },
      username: 'testuser',
      role: 'user',
      tokenVersion: 3, // bumped since the token was issued
    });

    await expect(strategy.validate(payload)).rejects.toThrow(
      UnauthorizedException,
    );
  });
});
