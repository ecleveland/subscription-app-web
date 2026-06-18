import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  MAIL_SERVICE,
  mailServiceFactory,
  type MailConfig,
} from './mail.service';

@Module({
  providers: [
    {
      provide: MAIL_SERVICE,
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const config: MailConfig = {
          driver:
            configService.get<'smtp' | 'console'>('mail.driver') ?? 'console',
          smtp: {
            host: configService.get<string>('mail.host') ?? '',
            port: configService.get<number>('mail.port') ?? 587,
            secure: configService.get<boolean>('mail.secure') ?? false,
            user: configService.get<string>('mail.user'),
            pass: configService.get<string>('mail.pass'),
            from:
              configService.get<string>('mail.from') ??
              'no-reply@subscription-app.local',
          },
        };
        return mailServiceFactory(
          config,
          process.env.NODE_ENV === 'production',
        );
      },
    },
  ],
  exports: [MAIL_SERVICE],
})
export class MailModule {}
