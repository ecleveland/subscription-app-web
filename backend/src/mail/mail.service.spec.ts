jest.mock('nodemailer', () => ({
  createTransport: jest.fn(() => ({
    sendMail: jest.fn().mockResolvedValue({}),
    verify: jest.fn().mockResolvedValue(true),
  })),
}));

import { createTransport } from 'nodemailer';
import {
  ConsoleMailService,
  SmtpMailService,
  mailServiceFactory,
  type SmtpMailConfig,
} from './mail.service';

describe('ConsoleMailService', () => {
  let service: ConsoleMailService;

  beforeEach(() => {
    service = new ConsoleMailService();
  });

  it('should log the reset email without throwing', async () => {
    const logSpy = jest.spyOn((service as any).logger, 'log');

    await service.sendPasswordResetEmail(
      'test@example.com',
      'http://localhost:3000/reset-password?token=abc123',
    );

    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('test@example.com'),
    );
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('token=abc123'),
    );
  });

  it('logs the invitation link and household name without throwing', async () => {
    const logSpy = jest.spyOn((service as any).logger, 'log');

    await service.sendInvitationEmail(
      'invitee@example.com',
      'http://localhost:3000/household/accept?token=xyz',
      'The Vegas',
    );

    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('invitee@example.com'),
    );
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('The Vegas'));
  });
});

describe('SmtpMailService', () => {
  const config: SmtpMailConfig = {
    host: 'smtp.example.com',
    port: 587,
    secure: false,
    user: 'mailer',
    pass: 'secret',
    from: 'No Reply <no-reply@example.com>',
  };
  const resetUrl = 'https://app.example.com/reset-password?token=secret-token';

  function makeService() {
    const sendMail = jest.fn().mockResolvedValue({ messageId: '1' });
    const service = new SmtpMailService(config, { sendMail } as any);
    return { service, sendMail };
  }

  it('sends the password-reset email via SMTP with the link in the body', async () => {
    const { service, sendMail } = makeService();

    await service.sendPasswordResetEmail('user@example.com', resetUrl);

    expect(sendMail).toHaveBeenCalledTimes(1);
    const message = sendMail.mock.calls[0][0];
    expect(message).toMatchObject({
      from: config.from,
      to: 'user@example.com',
      subject: 'Reset your password',
    });
    expect(message.text).toContain(resetUrl);
    expect(message.html).toContain(resetUrl);
  });

  it('logs only the recipient, never the token-bearing URL', async () => {
    const { service } = makeService();
    const logSpy = jest.spyOn((service as any).logger, 'log');

    await service.sendPasswordResetEmail('user@example.com', resetUrl);

    expect(logSpy).toHaveBeenCalledWith(
      'Password reset email sent to user@example.com',
    );
    for (const call of logSpy.mock.calls) {
      expect(String(call[0])).not.toContain('secret-token');
      expect(String(call[0])).not.toContain('reset-password?token');
    }
  });

  it('sends the invitation email and surfaces SMTP failures to the caller', async () => {
    const { service, sendMail } = makeService();
    await service.sendInvitationEmail(
      'invitee@example.com',
      'https://app.example.com/household/accept?token=t',
      'The Vegas',
    );
    expect(sendMail.mock.calls[0][0]).toMatchObject({
      to: 'invitee@example.com',
      subject: 'You\'ve been invited to join "The Vegas"',
    });

    sendMail.mockRejectedValueOnce(new Error('SMTP down'));
    await expect(
      service.sendInvitationEmail('x@example.com', 'url', 'H'),
    ).rejects.toThrow('SMTP down');
  });

  it('verifies the SMTP connection as a startup probe and propagates failures', async () => {
    const verify = jest.fn().mockResolvedValue(true);
    const service = new SmtpMailService(config, {
      sendMail: jest.fn(),
      verify,
    } as any);

    await service.verifyConnection();
    expect(verify).toHaveBeenCalledTimes(1);

    verify.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    await expect(service.verifyConnection()).rejects.toThrow('ECONNREFUSED');
  });

  describe('transporter construction', () => {
    beforeEach(() => jest.clearAllMocks());

    it('builds the transporter from config with auth when a user is set', () => {
      new SmtpMailService({
        host: 'smtp.example.com',
        port: 465,
        secure: true,
        user: 'mailer',
        pass: 'secret',
        from: 'f@example.com',
      });
      expect(createTransport).toHaveBeenCalledWith(
        expect.objectContaining({
          host: 'smtp.example.com',
          port: 465,
          secure: true,
          auth: { user: 'mailer', pass: 'secret' },
        }),
      );
    });

    it('omits auth when no user is configured (open relay)', () => {
      new SmtpMailService({
        host: 'smtp.example.com',
        port: 587,
        secure: false,
        from: 'f@example.com',
      });
      expect(createTransport).toHaveBeenCalledWith(
        expect.objectContaining({ auth: undefined }),
      );
    });
  });
});

describe('mailServiceFactory', () => {
  const smtp: SmtpMailConfig = {
    host: 'smtp.example.com',
    port: 587,
    secure: false,
    from: 'no-reply@example.com',
  };

  it('returns an SMTP mailer when the driver is smtp and a host is set', () => {
    const service = mailServiceFactory({ driver: 'smtp', smtp }, true);
    expect(service).toBeInstanceOf(SmtpMailService);
  });

  it('throws when the smtp driver has no host configured', () => {
    expect(() =>
      mailServiceFactory({ driver: 'smtp', smtp: { ...smtp, host: '' } }, true),
    ).toThrow(/SMTP_HOST/);
  });

  it('returns the console stub for the console driver outside production', () => {
    const service = mailServiceFactory({ driver: 'console', smtp }, false);
    expect(service).toBeInstanceOf(ConsoleMailService);
  });

  it('refuses the console driver in production', () => {
    expect(() => mailServiceFactory({ driver: 'console', smtp }, true)).toThrow(
      /console mail driver in production/,
    );
  });
});
