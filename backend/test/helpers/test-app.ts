import { randomUUID } from 'crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import type { MongoMemoryServer } from 'mongodb-memory-server';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { getConnectionToken } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';
import { AppModule } from '../../src/app.module';
import { startInMemoryMongo } from './mongo-server';

// Per-app fallback servers, only used when E2E_MONGO_URI is absent (see below).
const mongodInstances = new WeakMap<INestApplication, MongoMemoryServer>();

/**
 * A globally-unique database name for one app on the shared server. Must not
 * rely on any cross-file shared counter: jest runs each spec file with its own
 * module registry AND its own copy of `process.env`, so neither a module
 * variable nor an env counter is shared between files — two specs would collide
 * on the same name and leak data. A random UUID is collision-free without any
 * shared state.
 */
function uniqueDbName(): string {
  return `e2e_${randomUUID().replace(/-/g, '')}`;
}

export interface TestAppOptions {
  disableThrottling?: boolean;
}

/**
 * Resolve the MongoDB URI for a fresh, isolated database.
 *
 * Normal path: a single in-memory server is started once by `global-setup.ts`
 * and published as `E2E_MONGO_URI`; each app gets its own uniquely-named
 * database on it. Fallback path: if that env var is missing (e.g. a spec run
 * through a jest
 * config without the globalSetup wired in), spin up a dedicated server for this
 * app and track it so `closeTestApp` can stop it.
 */
async function resolveMongoUri(): Promise<{
  uri: string;
  mongod?: MongoMemoryServer;
}> {
  const shared = process.env.E2E_MONGO_URI;
  if (shared) {
    return { uri: `${shared.replace(/\/$/, '')}/${uniqueDbName()}` };
  }
  const mongod = await startInMemoryMongo();
  return { uri: mongod.getUri(), mongod };
}

export async function createTestApp(
  options: TestAppOptions = { disableThrottling: true },
): Promise<INestApplication> {
  const { uri, mongod } = await resolveMongoUri();

  process.env.MONGODB_URI = uri;
  process.env.JWT_SECRET = 'test-jwt-secret-at-least-32-chars-long';
  process.env.JWT_EXPIRES_IN = '1h';
  process.env.AUTH_PASSWORD_HASH = '';
  // Pin a non-production env so the production boot guards (configuration.ts)
  // never trip and skipIf stays eligible regardless of the caller's shell.
  process.env.NODE_ENV = 'test';
  // ThrottlerGuard is now a global APP_GUARD, which overrideGuard() can't
  // replace. Drive throttling through the app's real switch instead: the
  // module's skipIf honours THROTTLE_DISABLED outside production. The guard
  // reads this per-request, so it tracks the option.
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

  // Mirror main.ts so per-IP rate-limit tracking (X-Forwarded-For) behaves the
  // same under test as in production behind the Railway proxy.
  app.getHttpAdapter().getInstance().set('trust proxy', 1);

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Subscription App API')
    .setDescription('REST API for managing subscriptions')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api/docs', app, document);

  await app.init();
  // Unique-index builds race the first requests on a fresh database: a
  // duplicate-key insert that lands before its index exists succeeds instead
  // of conflicting (409 tests then flake). Model.init() resolves when each
  // model's autoIndex build completes. On failure, tear everything down —
  // leaking the app/mongod here turns a clear index error into a suite hang.
  try {
    const connection = app.get<Connection>(getConnectionToken());
    await Promise.all(
      Object.values(connection.models).map((model) => model.init()),
    );
  } catch (error) {
    await app.close();
    if (mongod) {
      await mongod.stop();
    }
    throw error;
  }
  if (mongod) {
    mongodInstances.set(app, mongod);
  }
  return app;
}

export async function closeTestApp(app: INestApplication): Promise<void> {
  await app.close();
  // Only fallback (non-shared) apps own a server that needs stopping; the shared
  // server is owned by global-teardown.ts.
  const mongod = mongodInstances.get(app);
  if (mongod) {
    await mongod.stop();
    mongodInstances.delete(app);
  }
}
