import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ValidationPipe, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { getConnectionToken } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';
import { Logger as PinoLogger } from 'nestjs-pino';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
import { UsersService } from './users/users.service';
import { HouseholdsMigrationService } from './households/households-migration.service';
import { CategoriesService } from './categories/categories.service';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
  });
  app.useLogger(app.get(PinoLogger));

  const configService = app.get(ConfigService);

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
      // CSP is enforced at the frontend (Next.js), which serves the rendered
      // HTML/JS a browser executes. This JSON API only emits data + the dev
      // Swagger UI, so a CSP header here protects nothing — left off by design.
      contentSecurityPolicy: false,
      strictTransportSecurity: {
        maxAge: 15552000,
        includeSubDomains: true,
      },
    }),
  );

  app.use(cookieParser());

  // Behind Railway's reverse proxy, trust the first hop so `req.ip` is the real
  // client IP. Without this the global rate limiter buckets every request under
  // the proxy's single IP — collapsing the per-IP limit into one shared limit
  // for the whole deployment.
  app.set('trust proxy', 1);

  app.enableCors({
    origin: configService.get<string>('cors.origin'),
    credentials: true,
  });

  // Swagger UI + /api/docs-json expose the full API surface; keep them out of
  // production so they're available in dev/staging only.
  if (configService.get<string>('nodeEnv') !== 'production') {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('Subscription App API')
      .setDescription('REST API for managing subscriptions')
      .setVersion('1.0')
      .addBearerAuth()
      .build();
    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('api/docs', app, document);
  }

  // Build every schema index before running migrations or accepting traffic.
  // Mongoose's default background autoIndex has two failure modes this closes:
  // a write that lands before its unique index exists succeeds instead of
  // conflicting, and a build that fails (e.g. pre-existing data violating a
  // unique constraint) dies silently, leaving the invariant unenforced with no
  // operator signal. Failures are logged loudly per model but don't abort the
  // boot: the app can serve traffic, and the log says what data to fix.
  const connection = app.get<Connection>(getConnectionToken());
  const indexLogger = new Logger('Indexes');
  await Promise.all(
    Object.values(connection.models).map(async (model) => {
      try {
        await model.init();
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        indexLogger.error(
          `Index build failed for ${model.modelName} — a unique constraint ` +
            `may be unenforced until the conflicting data is fixed: ${message}`,
        );
      }
    }),
  );

  // Idempotent startup tasks, run on every boot of every replica. seedAdmin
  // already swallows its own benign concurrent-boot duplicate; this outer guard
  // keeps any *other* failure in these non-critical tasks from crashing startup
  // — the app can serve traffic without them — so it logs a warning and
  // continues rather than aborting the process.
  try {
    const usersService = app.get(UsersService);
    const seedPasswordHash =
      configService.get<string>('auth.passwordHash') ?? '';
    if (seedPasswordHash) {
      await usersService.seedAdmin('admin', seedPasswordHash);
    }

    // Phase 1 household migration, in order:
    // 1. Backfill a personal household + owner membership for every
    //    pre-household user (idempotent; no-op once every user has one).
    // 2. Stamp existing subscriptions/notifications with the householdId of
    //    their owner's now-guaranteed active household. Both log their outcome.
    const householdsMigration = app.get(HouseholdsMigrationService);
    await householdsMigration.backfillPersonalHouseholds();
    await householdsMigration.stampExistingData();

    // 3. Seed default budgeting categories into any household that hasn't
    //    completed a seed (marked by defaultCategoriesSeededAt). Runs after the
    //    household backfill so every legacy user's new household is included.
    //    Idempotent: a no-op once every household is stamped; stamped
    //    households are never re-seeded, so user edits to defaults survive.
    const categoriesService = app.get(CategoriesService);
    await categoriesService.backfillDefaultCategories();
  } catch (error: unknown) {
    const message =
      error instanceof Error ? (error.stack ?? error.message) : String(error);
    // By this point seedAdmin and backfillPersonalHouseholds have swallowed
    // their own benign races, so anything reaching here is unexpected — and a
    // failed data migration can leave users live with un-scoped data. Log at
    // error level (not warn) so it's alarming and traceable, while still
    // letting the app serve traffic.
    new Logger('Bootstrap').error(
      `Startup admin seed/migration step failed; continuing without it: ${message}`,
    );
  }

  // Drain in-flight requests and close the Mongoose connection cleanly on
  // SIGTERM/SIGINT (e.g. Railway redeploys) instead of dropping live requests.
  app.enableShutdownHooks();

  const port = configService.get<number>('port') ?? 3001;
  await app.listen(port);
}
void bootstrap();
