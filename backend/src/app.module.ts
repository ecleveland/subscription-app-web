import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { ScheduleModule } from '@nestjs/schedule';
import { LoggerModule } from 'nestjs-pino';
import configuration from './config/configuration';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { AdminModule } from './admin/admin.module';
import { SubscriptionsModule } from './subscriptions/subscriptions.module';
import { NotificationsModule } from './notifications/notifications.module';
import { HouseholdsModule } from './households/households.module';
import { AccountsModule } from './accounts/accounts.module';
import { CategoriesModule } from './categories/categories.module';
import { CategoriesHttpModule } from './categories/categories-http.module';
import { TransactionsModule } from './transactions/transactions.module';
import { BudgetsModule } from './budgets/budgets.module';
import { RecurringModule } from './recurring/recurring.module';
import { ReconciliationModule } from './reconciliation/reconciliation.module';
import { HealthModule } from './health/health.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
    }),
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        pinoHttp: {
          level: configService.get<string>('logging.level') || 'info',
          ...(configService.get<boolean>('logging.pretty')
            ? { transport: { target: 'pino-pretty' } }
            : {}),
          redact: {
            paths: [
              'req.headers.authorization',
              'req.body.password',
              'req.body.currentPassword',
              'req.body.newPassword',
              'req.body.token',
            ],
            censor: '[REDACTED]',
          },
          serializers: {
            req(req: Record<string, unknown>) {
              return { method: req.method, url: req.url };
            },
            res(res: Record<string, unknown>) {
              return { statusCode: res.statusCode };
            },
          },
          autoLogging: true,
          customLogLevel: (
            _req: unknown,
            res: { statusCode: number },
            err: unknown,
          ) => {
            if (err || res.statusCode >= 500) return 'error';
            if (res.statusCode >= 400) return 'warn';
            return 'info';
          },
        },
      }),
    }),
    ThrottlerModule.forRoot({
      throttlers: [
        {
          name: 'default',
          ttl: 60000,
          limit: 60,
        },
      ],
      // Allow disabling rate limiting in automated test environments (e.g. the
      // Playwright E2E suite), where repeated auth requests would otherwise trip
      // the per-route limits. Defence-in-depth: only honoured outside production
      // (configuration.ts also throws at boot if this is set in production).
      skipIf: () =>
        process.env.NODE_ENV !== 'production' &&
        process.env.THROTTLE_DISABLED === 'true',
    }),
    MongooseModule.forRootAsync({
      useFactory: (configService: ConfigService) => ({
        uri: configService.get<string>('database.uri'),
      }),
      inject: [ConfigService],
    }),
    ScheduleModule.forRoot(),
    AuthModule,
    UsersModule,
    AdminModule,
    SubscriptionsModule,
    NotificationsModule,
    HouseholdsModule,
    AccountsModule,
    CategoriesModule,
    CategoriesHttpModule,
    TransactionsModule,
    BudgetsModule,
    RecurringModule,
    ReconciliationModule,
    HealthModule,
  ],
  // Apply rate limiting globally (per-route @Throttle decorators still override
  // the default limit). Without this, only routes with an explicit guard were
  // throttled, leaving subscriptions/admin/notifications/bulk routes unbounded.
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
