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
import { Transform } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { TransactionType } from '../schemas/transaction.schema';

export class QueryTransactionDto {
  @ApiPropertyOptional({ description: 'Filter by account' })
  @IsOptional()
  @IsMongoId()
  accountId?: string;

  @ApiPropertyOptional({ description: 'Filter by category' })
  @IsOptional()
  @IsMongoId()
  categoryId?: string;

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
  // Query params arrive as strings; coerce explicitly so "false" doesn't become
  // a truthy boolean under implicit conversion.
  @Transform(({ value }) => value === true || value === 'true')
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
