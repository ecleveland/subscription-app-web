import { Reflector } from '@nestjs/core';
import { ExecutionContext } from '@nestjs/common';
import { RolesGuard } from './roles.guard';
import { UserRole } from '../../users/schemas/user.schema';

describe('RolesGuard', () => {
  let guard: RolesGuard;
  let reflector: jest.Mocked<Reflector>;

  function createMockContext(role: string): ExecutionContext {
    return {
      switchToHttp: () => ({
        getRequest: () => ({
          user: { userId: '123', username: 'testuser', role },
        }),
      }),
      getHandler: () => jest.fn(),
      getClass: () => jest.fn(),
    } as unknown as ExecutionContext;
  }

  beforeEach(() => {
    reflector = {
      getAllAndOverride: jest.fn(),
    } as any;
    guard = new RolesGuard(reflector);
  });

  it('should allow access when no @Roles() decorator is present', () => {
    reflector.getAllAndOverride.mockReturnValue(undefined);
    const context = createMockContext('user');

    expect(guard.canActivate(context)).toBe(true);
  });

  it('should allow access when user role matches required role', () => {
    reflector.getAllAndOverride.mockReturnValue([UserRole.ADMIN]);
    const context = createMockContext(UserRole.ADMIN);

    expect(guard.canActivate(context)).toBe(true);
  });

  it('should deny access when user role does not match required role', () => {
    reflector.getAllAndOverride.mockReturnValue([UserRole.ADMIN]);
    const context = createMockContext(UserRole.USER);

    expect(guard.canActivate(context)).toBe(false);
  });

  it('should allow access when user role matches one of multiple required roles', () => {
    reflector.getAllAndOverride.mockReturnValue([
      UserRole.ADMIN,
      UserRole.USER,
    ]);
    const context = createMockContext(UserRole.USER);

    expect(guard.canActivate(context)).toBe(true);
  });
});
