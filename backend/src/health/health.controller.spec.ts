import { Test, TestingModule } from '@nestjs/testing';
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

  it('should return disconnected when database is not ready', () => {
    mockConnection.readyState = 0;

    const result = controller.check();

    expect(result.status).toBe('ok');
    expect(result.database).toBe('disconnected');
  });
});
