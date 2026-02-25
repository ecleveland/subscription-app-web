import configuration from './configuration';

describe('configuration', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('should throw when JWT_SECRET is not set', () => {
    delete process.env.JWT_SECRET;

    expect(() => configuration()).toThrow(
      'JWT_SECRET environment variable must be set',
    );
  });

  it('should use JWT_SECRET from env when provided', () => {
    process.env.JWT_SECRET = 'my-real-secret';

    const config = configuration();
    expect(config.auth.jwtSecret).toBe('my-real-secret');
  });
});
