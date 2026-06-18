import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection, ConnectionStates } from 'mongoose';

@Controller('health')
export class HealthController {
  constructor(@InjectConnection() private readonly connection: Connection) {}

  @Get()
  check() {
    const timestamp = new Date().toISOString();

    if (this.connection.readyState !== ConnectionStates.connected) {
      // Return 503 (not 200) so Railway/uptime monitors treat a DB outage as
      // unhealthy. Same diagnostic body, surfaced as the exception response.
      throw new ServiceUnavailableException({
        status: 'error',
        timestamp,
        database: 'disconnected',
      });
    }

    return {
      status: 'ok',
      timestamp,
      database: 'connected',
    };
  }
}
