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

  describe('nodeEnv', () => {
    beforeEach(() => {
      process.env.JWT_SECRET = STRONG_SECRET;
    });

    it('defaults to development when NODE_ENV is unset', () => {
      delete process.env.NODE_ENV;
      expect(configuration().nodeEnv).toBe('development');
    });

    it('reflects NODE_ENV when set', () => {
      process.env.NODE_ENV = 'test';
      expect(configuration().nodeEnv).toBe('test');
    });
  });

  describe('production guards', () => {
    beforeEach(() => {
      process.env.JWT_SECRET = STRONG_SECRET;
      process.env.NODE_ENV = 'production';
      process.env.FRONTEND_URL = 'https://app.example.com';
      delete process.env.THROTTLE_DISABLED;
    });

    it('throws when THROTTLE_DISABLED is set in production', () => {
      process.env.THROTTLE_DISABLED = 'true';
      expect(() => configuration()).toThrow(
        'THROTTLE_DISABLED must not be set in production',
      );
    });

    it('allows THROTTLE_DISABLED outside production', () => {
      process.env.NODE_ENV = 'development';
      process.env.THROTTLE_DISABLED = 'true';
      delete process.env.FRONTEND_URL;
      expect(() => configuration()).not.toThrow();
    });

    it('throws when FRONTEND_URL is unset in production', () => {
      delete process.env.FRONTEND_URL;
      expect(() => configuration()).toThrow(
        'FRONTEND_URL must be set in production',
      );
    });

    it('does not throw in production when FRONTEND_URL is set and throttling is enabled', () => {
      expect(() => configuration()).not.toThrow();
      expect(configuration().cors.origin).toBe('https://app.example.com');
    });

    it('falls back to a localhost CORS origin outside production', () => {
      process.env.NODE_ENV = 'development';
      delete process.env.FRONTEND_URL;
      expect(configuration().cors.origin).toBe('http://localhost:3000');
    });
  });

  describe('mail', () => {
    beforeEach(() => {
      process.env.JWT_SECRET = STRONG_SECRET;
      // The smtp-in-production cases below set NODE_ENV=production, which now
      // requires FRONTEND_URL — provide one so only the mail behaviour is tested.
      process.env.FRONTEND_URL = 'https://app.example.com';
      delete process.env.MAIL_DRIVER;
      delete process.env.NODE_ENV;
      delete process.env.SMTP_HOST;
      delete process.env.SMTP_PORT;
      delete process.env.MAIL_FROM;
    });

    it('defaults the driver to the console stub outside production', () => {
      expect(configuration().mail.driver).toBe('console');
    });

    it('defaults the driver to smtp in production', () => {
      process.env.NODE_ENV = 'production';
      expect(configuration().mail.driver).toBe('smtp');
    });

    it('lets MAIL_DRIVER override the default', () => {
      process.env.NODE_ENV = 'production';
      process.env.MAIL_DRIVER = 'console';
      expect(configuration().mail.driver).toBe('console');
    });

    it('defaults the SMTP port to 587 and secure to false when unset', () => {
      delete process.env.SMTP_SECURE;
      const { mail } = configuration();
      expect(mail.port).toBe(587);
      expect(mail.secure).toBe(false);
    });

    it('treats SMTP_SECURE as true only for the literal "true"', () => {
      process.env.SMTP_SECURE = 'true';
      expect(configuration().mail.secure).toBe(true);
      process.env.SMTP_SECURE = '1';
      expect(configuration().mail.secure).toBe(false);
    });

    it('reads SMTP host/port and the from address from env', () => {
      process.env.SMTP_HOST = 'smtp.example.com';
      process.env.SMTP_PORT = '2525';
      process.env.MAIL_FROM = 'App <hi@example.com>';

      const { mail } = configuration();
      expect(mail.host).toBe('smtp.example.com');
      expect(mail.port).toBe(2525);
      expect(mail.from).toBe('App <hi@example.com>');
    });
  });
});
