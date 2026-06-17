import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AccountsService } from './accounts.service';
import { Account, AccountSchema } from './schemas/account.schema';

// Phase 2 foundation: the Account data model + service. The HTTP API (CRUD,
// balances, archive) lands in VEG-398 and the transaction ledger that maintains
// balances lands in VEG-399; AccountsService is exported so both can build on it.
@Module({
  imports: [
    MongooseModule.forFeature([{ name: Account.name, schema: AccountSchema }]),
  ],
  providers: [AccountsService],
  exports: [AccountsService],
})
export class AccountsModule {}
