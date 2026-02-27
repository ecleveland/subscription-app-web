import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { UsersService } from './users/users.service';
import { SubscriptionsService } from './subscriptions/subscriptions.service';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

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

  // Seed admin user from env vars on first startup (legacy migration)
  const usersService = app.get(UsersService);
  const seedPasswordHash = configService.get<string>('auth.passwordHash') ?? '';
  if (seedPasswordHash) {
    await usersService.seedAdmin('admin', seedPasswordHash);
  }

  // Migrate existing subscriptions without userId to the admin user
  const admin = await usersService.findByUsername('admin');
  if (admin) {
    const subscriptionsService = app.get(SubscriptionsService);
    const migrated = await subscriptionsService.migrateUnownedSubscriptions(
      admin._id.toString(),
    );
    if (migrated > 0) {
      console.log(`Migrated ${migrated} existing subscriptions to admin user`);
    }
  }

  const port = configService.get<number>('port') ?? 3001;
  await app.listen(port);
}
void bootstrap();
