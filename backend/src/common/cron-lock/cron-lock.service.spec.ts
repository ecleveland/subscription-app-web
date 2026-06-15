import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { CronLockService } from './cron-lock.service';
import { CronLock } from './cron-lock.schema';

describe('CronLockService', () => {
  let service: CronLockService;
  let saveMock: jest.Mock;
  let mockModel: jest.Mock & Record<string, unknown>;

  beforeEach(async () => {
    saveMock = jest.fn().mockResolvedValue(undefined);
    mockModel = jest.fn().mockImplementation((dto) => ({
      ...dto,
      save: saveMock,
    })) as jest.Mock & Record<string, unknown>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CronLockService,
        { provide: getModelToken(CronLock.name), useValue: mockModel },
      ],
    }).compile();

    service = module.get<CronLockService>(CronLockService);
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.useRealTimers();
  });

  describe('runDateKey', () => {
    it('formats a date as a UTC YYYY-MM-DD key', () => {
      expect(CronLockService.runDateKey(new Date('2026-06-14T23:30:00Z'))).toBe(
        '2026-06-14',
      );
    });
  });

  describe('tryAcquire', () => {
    it('returns true and persists the lock with an expiry when insert succeeds', async () => {
      const now = new Date('2026-06-14T09:00:00Z');

      const acquired = await service.tryAcquire(
        'renewal-reminders',
        '2026-06-14',
        60_000,
        now,
      );

      expect(acquired).toBe(true);
      expect(mockModel).toHaveBeenCalledWith(
        expect.objectContaining({
          key: 'renewal-reminders',
          runDate: '2026-06-14',
          expiresAt: new Date(now.getTime() + 60_000),
        }),
      );
      expect(saveMock).toHaveBeenCalled();
    });

    it('returns false when another instance already holds the lock (E11000)', async () => {
      const dupError: Error & { code?: number } = new Error('dup key');
      dupError.code = 11000;
      saveMock.mockRejectedValueOnce(dupError);

      const acquired = await service.tryAcquire(
        'renewal-reminders',
        '2026-06-14',
      );

      expect(acquired).toBe(false);
    });

    it('rethrows non-duplicate errors', async () => {
      saveMock.mockRejectedValueOnce(new Error('connection lost'));

      await expect(
        service.tryAcquire('renewal-reminders', '2026-06-14'),
      ).rejects.toThrow('connection lost');
    });
  });
});
