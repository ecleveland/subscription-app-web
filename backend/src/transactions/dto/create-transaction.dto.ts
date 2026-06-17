import {
  IsString,
  IsEnum,
  IsInt,
  IsOptional,
  IsMongoId,
  IsDateString,
  IsArray,
  IsBoolean,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { TransactionType } from '../schemas/transaction.schema';

export class CreateTransactionDto {
  @ApiProperty({
    description: 'Account the transaction posts to (source for a transfer)',
  })
  @IsMongoId()
  accountId: string;

  @ApiProperty({ enum: TransactionType, example: TransactionType.EXPENSE })
  @IsEnum(TransactionType)
  type: TransactionType;

  @ApiProperty({
    description:
      'Positive amount in integer minor units (cents); the sign of its effect ' +
      'is derived from `type`.',
    example: 4200,
    minimum: 1,
  })
  @IsInt()
  @Min(1)
  amountCents: number;

  @ApiProperty({
    description: 'Transaction date (ISO 8601)',
    example: '2026-06-17',
  })
  @IsDateString()
  date: string;

  @ApiPropertyOptional({
    description: 'Category (required for income/expense; omit for transfers)',
  })
  @IsOptional()
  @IsMongoId()
  categoryId?: string;

  @ApiPropertyOptional({
    description: 'Destination account (required for transfers; omit otherwise)',
  })
  @IsOptional()
  @IsMongoId()
  transferAccountId?: string;

  // Optional; an empty string is allowed so an update can clear a previously-set
  // payee (the create path omits it when blank).
  @ApiPropertyOptional({
    description: 'Payee / description',
    example: 'Whole Foods',
  })
  @IsOptional()
  @IsString()
  payee?: string;

  @ApiPropertyOptional({ description: 'Free-form notes' })
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiPropertyOptional({ type: [String], example: ['groceries'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @ApiPropertyOptional({
    description: 'Whether the transaction has cleared',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  cleared?: boolean;
}
