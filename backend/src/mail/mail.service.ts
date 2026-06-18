import { Injectable, Logger } from '@nestjs/common';
import { createTransport, type Transporter } from 'nodemailer';

export const MAIL_SERVICE = 'MAIL_SERVICE';

export interface MailService {
  sendPasswordResetEmail(email: string, resetUrl: string): Promise<void>;
  sendInvitationEmail(
    email: string,
    inviteUrl: string,
    householdName: string,
  ): Promise<void>;
}

/**
 * Dev/test driver: prints the link to the log so a developer can complete the
 * flow locally. NEVER selected in production (see `mailServiceFactory`) — the
 * link carries a plaintext token that must not land in production logs.
 */
@Injectable()
export class ConsoleMailService implements MailService {
  private readonly logger = new Logger(ConsoleMailService.name);

  sendPasswordResetEmail(email: string, resetUrl: string): Promise<void> {
    this.logger.log(
      `Password reset requested for ${email}. Reset URL: ${resetUrl}`,
    );
    return Promise.resolve();
  }

  sendInvitationEmail(
    email: string,
    inviteUrl: string,
    householdName: string,
  ): Promise<void> {
    this.logger.log(
      `Household invitation for ${email} to join "${householdName}". Invite URL: ${inviteUrl}`,
    );
    return Promise.resolve();
  }
}

export interface SmtpMailConfig {
  host: string;
  port: number;
  secure: boolean;
  user?: string;
  pass?: string;
  from: string;
}

/**
 * Production driver: sends a real email over SMTP via nodemailer. Logs only the
 * recipient address — never the token-bearing URL — so a password-reset
 * credential can't leak into application logs (the C4 audit finding).
 */
export class SmtpMailService implements MailService {
  private readonly logger = new Logger(SmtpMailService.name);
  private readonly transporter: Transporter;

  // `transporter` is injectable for tests; in production it's built from config.
  constructor(
    private readonly config: SmtpMailConfig,
    transporter?: Transporter,
  ) {
    this.transporter =
      transporter ??
      createTransport({
        host: config.host,
        port: config.port,
        secure: config.secure,
        auth: config.user
          ? { user: config.user, pass: config.pass }
          : undefined,
      });
  }

  async sendPasswordResetEmail(email: string, resetUrl: string): Promise<void> {
    await this.transporter.sendMail({
      from: this.config.from,
      to: email,
      subject: 'Reset your password',
      text: `We received a request to reset your password. Open the link below to choose a new one. If you didn't request this, you can ignore this email.\n\n${resetUrl}`,
      html: `<p>We received a request to reset your password. Click the link below to choose a new one. If you didn't request this, you can ignore this email.</p><p><a href="${resetUrl}">Reset your password</a></p>`,
    });
    this.logger.log(`Password reset email sent to ${email}`);
  }

  async sendInvitationEmail(
    email: string,
    inviteUrl: string,
    householdName: string,
  ): Promise<void> {
    await this.transporter.sendMail({
      from: this.config.from,
      to: email,
      subject: `You've been invited to join "${householdName}"`,
      text: `You've been invited to join the household "${householdName}". Open the link below to accept.\n\n${inviteUrl}`,
      html: `<p>You've been invited to join the household "${householdName}".</p><p><a href="${inviteUrl}">Accept the invitation</a></p>`,
    });
    this.logger.log(`Household invitation email sent to ${email}`);
  }
}

export interface MailConfig {
  driver: 'smtp' | 'console';
  smtp: SmtpMailConfig;
}

/**
 * Select the mailer for the running environment. The console driver is a
 * dev-only convenience that logs the reset link; refusing it in production is a
 * hard guard so a misconfigured prod deploy fails fast at startup rather than
 * silently logging password-reset tokens and sending no email.
 */
export function mailServiceFactory(
  config: MailConfig,
  isProduction: boolean,
): MailService {
  if (config.driver === 'smtp') {
    if (!config.smtp.host) {
      throw new Error(
        'MAIL_DRIVER=smtp requires SMTP_HOST to be set (and SMTP_USER/SMTP_PASS for authenticated relays).',
      );
    }
    return new SmtpMailService(config.smtp);
  }

  if (isProduction) {
    throw new Error(
      'Refusing to use the console mail driver in production: it would log ' +
        'password-reset tokens and send no email. Set MAIL_DRIVER=smtp and ' +
        'configure SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASS/MAIL_FROM.',
    );
  }

  return new ConsoleMailService();
}
