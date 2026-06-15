import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Logger as PinoLogger } from 'nestjs-pino';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { UsersService } from './users/users.service';
import { SubscriptionsService } from './subscriptions/subscriptions.service';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
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
      contentSecurityPolicy: false,
      strictTransportSecurity: {
        maxAge: 15552000,
        includeSubDomains: true,
      },
    }),
  );

  app.enableCors({
    origin: configService.get<string>('cors.origin'),
    credentials: true,
  });

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Subscription App API')
    .setDescription('REST API for managing subscriptions')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api/docs', app, document);

  // Legacy startup tasks: seed the env-configured admin and migrate any
  // pre-multi-user subscriptions to it. Both are idempotent and run on every
  // boot of every replica. seedAdmin already swallows its own benign
  // concurrent-boot duplicate; this outer guard keeps any *other* failure in
  // these non-critical legacy tasks from crashing startup — the app can serve
  // traffic without them — so it logs a warning and continues rather than
  // aborting the process.
  try {
    const usersService = app.get(UsersService);
    const seedPasswordHash =
      configService.get<string>('auth.passwordHash') ?? '';
    if (seedPasswordHash) {
      await usersService.seedAdmin('admin', seedPasswordHash);
    }

    const admin = await usersService.findByUsername('admin');
    if (admin) {
      const subscriptionsService = app.get(SubscriptionsService);
      const migrated = await subscriptionsService.migrateUnownedSubscriptions(
        admin._id.toString(),
      );
      if (migrated > 0) {
        new Logger('Bootstrap').log(
          `Migrated ${migrated} existing subscriptions to admin user`,
        );
      }
    }
  } catch (error: unknown) {
    const message =
      error instanceof Error ? (error.stack ?? error.message) : String(error);
    new Logger('Bootstrap').warn(
      `Startup admin seed/migration step failed; continuing: ${message}`,
    );
  }

  const port = configService.get<number>('port') ?? 3001;
  await app.listen(port);
}
void bootstrap();
