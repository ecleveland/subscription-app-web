export default () => {
  if (!process.env.JWT_SECRET) {
    throw new Error('JWT_SECRET environment variable must be set');
  }
  if (process.env.JWT_SECRET.length < 32) {
    throw new Error(
      'JWT_SECRET must be at least 32 characters for adequate entropy',
    );
  }

  return {
    port: parseInt(process.env.PORT ?? '3001', 10),
    database: {
      uri: process.env.MONGODB_URI || 'mongodb://localhost:27017/subscriptions',
    },
    auth: {
      passwordHash: process.env.AUTH_PASSWORD_HASH || '',
      jwtSecret: process.env.JWT_SECRET,
      jwtExpiresIn: process.env.JWT_EXPIRES_IN || '15m',
      // Pepper for HMAC-ing refresh/reset tokens at rest. Falls back to the JWT
      // secret (which is itself required and >=32 chars) when not set separately.
      tokenPepper: process.env.TOKEN_PEPPER || process.env.JWT_SECRET,
    },
    logging: {
      level: process.env.LOG_LEVEL || 'info',
      pretty: process.env.LOG_PRETTY === 'true',
    },
    frontendUrl: process.env.FRONTEND_URL || 'http://localhost:3000',
    cors: {
      origin: process.env.FRONTEND_URL || 'http://localhost:3000',
    },
    mail: {
      // SMTP in production (real delivery), console stub otherwise (dev/test).
      // Overridable via MAIL_DRIVER for local SMTP testing.
      driver: (process.env.MAIL_DRIVER ||
        (process.env.NODE_ENV === 'production' ? 'smtp' : 'console')) as
        | 'smtp'
        | 'console',
      host: process.env.SMTP_HOST || '',
      port: parseInt(process.env.SMTP_PORT ?? '587', 10),
      secure: process.env.SMTP_SECURE === 'true',
      user: process.env.SMTP_USER || undefined,
      pass: process.env.SMTP_PASS || undefined,
      from:
        process.env.MAIL_FROM ||
        'Subscription App <no-reply@subscription-app.local>',
    },
  };
};
