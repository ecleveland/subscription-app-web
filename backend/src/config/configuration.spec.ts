import configuration from './configuration';

describe('configuration', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  const STRONG_SECRET = 'test-jwt-secret-at-least-32-chars-long';

  it('should throw when JWT_SECRET is not set', () => {
    delete process.env.JWT_SECRET;

    expect(() => configuration()).toThrow(
      'JWT_SECRET environment variable must be set',
    );
  });

  it('should throw when JWT_SECRET is shorter than 32 characters', () => {
    process.env.JWT_SECRET = 'too-short-secret';

    expect(() => configuration()).toThrow(
      'JWT_SECRET must be at least 32 characters',
    );
  });

  it('should use JWT_SECRET from env when provided', () => {
    process.env.JWT_SECRET = STRONG_SECRET;

    const config = configuration();
    expect(config.auth.jwtSecret).toBe(STRONG_SECRET);
  });

  it('should default the token pepper to JWT_SECRET when TOKEN_PEPPER is unset', () => {
    process.env.JWT_SECRET = STRONG_SECRET;
    delete process.env.TOKEN_PEPPER;

    const config = configuration();
    expect(config.auth.tokenPepper).toBe(STRONG_SECRET);
  });

  it('should default the access-token TTL to 15m', () => {
    process.env.JWT_SECRET = STRONG_SECRET;
    delete process.env.JWT_EXPIRES_IN;

    const config = configuration();
    expect(config.auth.jwtExpiresIn).toBe('15m');
  });
});
