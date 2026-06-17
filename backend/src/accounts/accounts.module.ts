import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AccountsController } from './accounts.controller';
import { AccountsService } from './accounts.service';
import { Account, AccountSchema } from './schemas/account.schema';
import { HouseholdsModule } from '../households/households.module';

// Phase 2: the Account data model, service, and HTTP API (VEG-398). The
// transaction ledger that maintains balances lands in VEG-399; AccountsService
// is exported so it can build on this. HouseholdsModule provides the
// HouseholdGuard the controller applies after JwtAuthGuard.
@Module({
  imports: [
    MongooseModule.forFeature([{ name: Account.name, schema: AccountSchema }]),
    HouseholdsModule,
  ],
  controllers: [AccountsController],
  providers: [AccountsService],
  exports: [AccountsService],
})
export class AccountsModule {}
