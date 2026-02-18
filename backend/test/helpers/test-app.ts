import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { ThrottlerGuard } from '@nestjs/throttler';
import { AppModule } from '../../src/app.module';
import { SubscriptionsService } from '../../src/subscriptions/subscriptions.service';

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
  process.env.JWT_SECRET = 'test-secret';
  process.env.JWT_EXPIRES_IN = '1h';
  process.env.AUTH_PASSWORD_HASH = '';

  // Disable advance cooldown in E2E tests so billing date tests work
  SubscriptionsService.ADVANCE_COOLDOWN_MS = 0;

  let builder = Test.createTestingModule({
    imports: [AppModule],
  });

  if (options.disableThrottling) {
    builder = builder
      .overrideGuard(ThrottlerGuard)
      .useValue({ canActivate: () => true }) as unknown as typeof builder;
  }

  const moduleFixture: TestingModule = await builder.compile();

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
