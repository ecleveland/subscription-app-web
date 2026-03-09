import { Module } from '@nestjs/common';
import { MAIL_SERVICE, ConsoleMailService } from './mail.service';

@Module({
  providers: [
    {
      provide: MAIL_SERVICE,
      useClass: ConsoleMailService,
    },
  ],
  exports: [MAIL_SERVICE],
})
export class MailModule {}
