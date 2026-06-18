import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { AppModule } from '../../src/app.module';

// Track mongod instances per app for proper cleanup
const mongodInstances = new WeakMap<INestApplication, MongoMemoryServer>();

export interface TestAppOptions {
  disableThrottling?: boolean;
}

export async function createTestApp(
  options: TestAppOptions = { disableThrottling: true },
): Promise<INestApplication> {
  const mongod = await MongoMemoryServer.create();

  process.env.MONGODB_URI = mongod.getUri();
  process.env.JWT_SECRET = 'test-jwt-secret-at-least-32-chars-long';
  process.env.JWT_EXPIRES_IN = '1h';
  process.env.AUTH_PASSWORD_HASH = '';
  // ThrottlerGuard is now a global APP_GUARD, which overrideGuard() can't
  // replace. Drive throttling through the app's real switch instead: the
  // module's skipIf honours THROTTLE_DISABLED outside production (NODE_ENV is
  // 'test' here). The guard reads this per-request, so it tracks the option.
  process.env.THROTTLE_DISABLED = options.disableThrottling ? 'true' : 'false';

  const moduleFixture: TestingModule = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  const app = moduleFixture.createNestApplication();
  app.setGlobalPrefix('api');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  );

  app.use(
    helmet({
      contentSecurityPolicy: false,
      strictTransportSecurity: {
        maxAge: 15552000,
        includeSubDomains: true,
      },
    }),
  );

  app.use(cookieParser());

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Subscription App API')
    .setDescription('REST API for managing subscriptions')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api/docs', app, document);

  await app.init();
  mongodInstances.set(app, mongod);
  return app;
}

export async function closeTestApp(app: INestApplication): Promise<void> {
  await app.close();
  const mongod = mongodInstances.get(app);
  if (mongod) {
    await mongod.stop();
    mongodInstances.delete(app);
  }
}
