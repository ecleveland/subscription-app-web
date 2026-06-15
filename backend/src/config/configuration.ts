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
  };
};
