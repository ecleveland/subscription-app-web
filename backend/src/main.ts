import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
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

  app.enableCors({
    origin: configService.get<string>('cors.origin'),
    credentials: true,
  });

  // Seed admin user from env vars on first startup
  const usersService = app.get(UsersService);
  const seedUsername = configService.get<string>('auth.username') ?? 'admin';
  const seedPasswordHash = configService.get<string>('auth.passwordHash') ?? '';
  if (seedPasswordHash) {
    await usersService.seedAdmin(seedUsername, seedPasswordHash);
  }

  // Migrate existing subscriptions without userId to the admin user
  const admin = await usersService.findByUsername(seedUsername);
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
