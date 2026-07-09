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
import { buildAllIndexes } from './database/build-all-indexes';
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

  // Build every schema index before running migrations or accepting traffic
  // (see buildAllIndexes for the background-autoIndex failure modes this
  // closes). A failed build is FATAL: serving writes without a uniqueness
  // invariant silently corrupts data that only gets harder to fix (e.g. a
  // second ACTIVE membership per user disables addMember's 409 entirely),
  // whereas refusing to boot surfaces the named model in the deploy log.
  try {
    await buildAllIndexes(app.get<Connection>(getConnectionToken()));
  } catch (error: unknown) {
    const message =
      error instanceof Error ? (error.stack ?? error.message) : String(error);
    new Logger('Indexes').error(`Aborting startup: ${message}`);
    throw error;
  }

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
// Explicit exit rather than relying on Node's default unhandled-rejection
// crash: under --unhandled-rejections=warn (or a wrapper that installs a
// handler) a rethrown boot failure would otherwise leave a zombie process
// that neither serves traffic nor crash-loops for the orchestrator.
bootstrap().catch((error: unknown) => {
  const message =
    error instanceof Error ? (error.stack ?? error.message) : String(error);
  new Logger('Bootstrap').error(`Startup failed: ${message}`);
  process.exit(1);
});
