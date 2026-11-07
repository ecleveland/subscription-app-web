import { IsDateString, IsEnum, IsMongoId, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ReimbursementStatus } from '../schemas/transaction.schema';

// The reimbursement block on a transaction (VEG-700). The shape rules that
// depend on status, label and type live in TransactionsService, because they
// need the merged transaction to decide.
export class ReimbursementDto {
  @ApiProperty({ enum: ReimbursementStatus, example: ReimbursementStatus.OWED })
  @IsEnum(ReimbursementStatus)
  status: ReimbursementStatus;

  @ApiPropertyOptional({
    description:
      'When the expense was paid back (ISO 8601). Required when status is ' +
      'reimbursed, absent when owed.',
    example: '2026-09-15',
  })
  @IsOptional()
  @IsDateString()
  reimbursedAt?: string;

  @ApiPropertyOptional({
    description:
      'Income transaction in the same household that paid the expense back. ' +
      'Optional when reimbursed, absent when owed.',
  })
  @IsOptional()
  @IsMongoId()
  reimbursedByTransactionId?: string;
}
