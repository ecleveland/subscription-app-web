import { ConsoleMailService } from './mail.service';

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
});
