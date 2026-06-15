import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { CronLockService } from './cron-lock.service';
import { CronLock, CronLockSchema } from './cron-lock.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: CronLock.name, schema: CronLockSchema },
    ]),
  ],
  providers: [CronLockService],
  exports: [CronLockService],
})
export class CronLockModule {}
