import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { AppModule } from '../../src/app.module';

// Track mongod instances per app for proper cleanup
const mongodInstances = new WeakMap<INestApplication, MongoMemoryServer>();

export async function createTestApp(): Promise<INestApplication> {
  const mongod = await MongoMemoryServer.create();

  process.env.MONGODB_URI = mongod.getUri();
  process.env.JWT_SECRET = 'test-secret';
  process.env.JWT_EXPIRES_IN = '1h';
  process.env.AUTH_PASSWORD_HASH = '';

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
