export default () => ({
  port: parseInt(process.env.PORT ?? '3001', 10),
  database: {
    uri: process.env.MONGODB_URI || 'mongodb://localhost:27017/subscriptions',
  },
  auth: {
    username: process.env.AUTH_USERNAME || 'admin',
    passwordHash: process.env.AUTH_PASSWORD_HASH || '',
    jwtSecret: process.env.JWT_SECRET || 'change-me',
    jwtExpiresIn: process.env.JWT_EXPIRES_IN || '24h',
  },
  cors: {
    origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  },
});
