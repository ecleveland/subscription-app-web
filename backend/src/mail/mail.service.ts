import { Injectable, Logger } from '@nestjs/common';

export const MAIL_SERVICE = 'MAIL_SERVICE';

export interface MailService {
  sendPasswordResetEmail(email: string, resetUrl: string): Promise<void>;
}

@Injectable()
export class ConsoleMailService implements MailService {
  private readonly logger = new Logger(ConsoleMailService.name);

  sendPasswordResetEmail(email: string, resetUrl: string): Promise<void> {
    this.logger.log(
      `Password reset requested for ${email}. Reset URL: ${resetUrl}`,
    );
    return Promise.resolve();
  }
}
