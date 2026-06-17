import { PartialType } from '@nestjs/swagger';
import { CreateTransactionDto } from './create-transaction.dto';

// All CreateTransactionDto fields optional (validation preserved). The service
// merges the patch onto the existing transaction, re-validates the resulting
// type/category/transfer combination, and re-points account balances.
export class UpdateTransactionDto extends PartialType(CreateTransactionDto) {}
