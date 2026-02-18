import configuration from './configuration';

describe('configuration', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('should throw when JWT_SECRET is not set in production', () => {
    delete process.env.JWT_SECRET;
    process.env.NODE_ENV = 'production';

    expect(() => configuration()).toThrow(
      'JWT_SECRET environment variable must be set in production',
    );
  });

  it('should use dev fallback when JWT_SECRET is not set outside production', () => {
    delete process.env.JWT_SECRET;
    process.env.NODE_ENV = 'development';

    const config = configuration();
    expect(config.auth.jwtSecret).toBe(
      'dev-only-secret-do-not-use-in-production',
    );
  });

  it('should use JWT_SECRET from env when provided', () => {
    process.env.JWT_SECRET = 'my-real-secret';
    process.env.NODE_ENV = 'production';

    const config = configuration();
    expect(config.auth.jwtSecret).toBe('my-real-secret');
  });
});
