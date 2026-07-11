import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  RecurringTransaction,
  RecurringTransactionDocument,
} from './schemas/recurring-transaction.schema';

// Phase 4 scaffold (VEG-465): the data model and module wiring only. The
// household-scoped CRUD (VEG-466) and the materialization scheduler that turns
// due schedules into ledger Transactions (VEG-467) land next and build on the
// model injected here.
@Injectable()
export class RecurringService {
  private readonly logger = new Logger(RecurringService.name);

  constructor(
    @InjectModel(RecurringTransaction.name)
    private readonly recurringModel: Model<RecurringTransactionDocument>,
  ) {}
}
