import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { TransactionsController } from './transactions.controller';
import { TransactionsService } from './transactions.service';
import { Transaction, TransactionSchema } from './schemas/transaction.schema';
import { AccountsModule } from '../accounts/accounts.module';
import { CategoriesModule } from '../categories/categories.module';
import { HouseholdsModule } from '../households/households.module';

// Phase 2 core: the transaction ledger. Depends on AccountsService (to keep
// account balances in sync via applyBalanceDelta) and CategoriesService (to
// validate that a referenced category belongs to the household). HouseholdsModule
// provides the HouseholdGuard the controller applies after JwtAuthGuard.
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Transaction.name, schema: TransactionSchema },
    ]),
    AccountsModule,
    CategoriesModule,
    HouseholdsModule,
  ],
  controllers: [TransactionsController],
  providers: [TransactionsService],
  exports: [TransactionsService],
})
export class TransactionsModule {}
