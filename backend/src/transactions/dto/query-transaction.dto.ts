import {
  IsOptional,
  IsEnum,
  IsMongoId,
  IsDateString,
  IsBoolean,
  IsInt,
  Min,
  Max,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { TransactionType } from '../schemas/transaction.schema';
import { TransformBooleanParam } from '../../common/validation/transform-raw-value';

export class QueryTransactionDto {
  @ApiPropertyOptional({ description: 'Filter by account' })
  @IsOptional()
  @IsMongoId()
  accountId?: string;

  @ApiPropertyOptional({ description: 'Filter by category' })
  @IsOptional()
  @IsMongoId()
  categoryId?: string;

  @ApiPropertyOptional({
    description: "Filter to a recurring schedule's materialized transactions",
  })
  @IsOptional()
  @IsMongoId()
  recurringId?: string;

  @ApiPropertyOptional({ enum: TransactionType })
  @IsOptional()
  @IsEnum(TransactionType)
  type?: TransactionType;

  @ApiPropertyOptional({
    description: 'Only transactions on/after this date (ISO 8601)',
  })
  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @ApiPropertyOptional({
    description: 'Only transactions on/before this date (ISO 8601)',
  })
  @IsOptional()
  @IsDateString()
  dateTo?: string;

  @ApiPropertyOptional({ description: 'Filter by cleared status' })
  @IsOptional()
  // Reads the raw pre-coercion value: under the global pipe's
  // enableImplicitConversion, a bare value-based transform sees "false" already
  // coerced to boolean true, inverting ?cleared=false (VEG-475).
  @TransformBooleanParam
  @IsBoolean()
  cleared?: boolean;

  @ApiPropertyOptional({ description: 'Page number (1-indexed)', minimum: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({
    description: 'Results per page (0 = all)',
    minimum: 0,
    maximum: 100,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  limit?: number;
}
