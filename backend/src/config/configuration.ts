export default () => {
  const isProduction = process.env.NODE_ENV === 'production';

  if (isProduction && !process.env.JWT_SECRET) {
    throw new Error(
      'JWT_SECRET environment variable must be set in production',
    );
  }

  return {
    port: parseInt(process.env.PORT ?? '3001', 10),
    database: {
      uri: process.env.MONGODB_URI || 'mongodb://localhost:27017/subscriptions',
    },
    auth: {
      username: process.env.AUTH_USERNAME || 'admin',
      passwordHash: process.env.AUTH_PASSWORD_HASH || '',
      jwtSecret:
        process.env.JWT_SECRET || 'dev-only-secret-do-not-use-in-production',
      jwtExpiresIn: process.env.JWT_EXPIRES_IN || '24h',
    },
    cors: {
      origin: process.env.FRONTEND_URL || 'http://localhost:3000',
    },
  };
};
