import { Test, TestingModule } from '@nestjs/testing';
import { ServiceUnavailableException } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';
import { HealthController } from './health.controller';

describe('HealthController', () => {
  let controller: HealthController;
  let mockConnection: { readyState: number };

  beforeEach(async () => {
    mockConnection = { readyState: 1 };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [{ provide: getConnectionToken(), useValue: mockConnection }],
    }).compile();

    controller = module.get<HealthController>(HealthController);
  });

  it('should return ok with connected database', () => {
    const result = controller.check();

    expect(result.status).toBe('ok');
    expect(result.database).toBe('connected');
    expect(result.timestamp).toBeDefined();
  });

  it('should throw 503 ServiceUnavailable with a diagnostic body when the database is not ready', () => {
    mockConnection.readyState = 0;

    expect(() => controller.check()).toThrow(ServiceUnavailableException);

    try {
      controller.check();
      throw new Error('expected check() to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(ServiceUnavailableException);
      const response = (err as ServiceUnavailableException).getResponse();
      expect(response).toMatchObject({
        status: 'error',
        database: 'disconnected',
      });
      expect((response as { timestamp: string }).timestamp).toBeDefined();
    }
  });
});
