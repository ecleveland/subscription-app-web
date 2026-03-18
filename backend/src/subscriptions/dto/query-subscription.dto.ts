import {
  IsOptional,
  IsString,
  IsEnum,
  IsIn,
  IsInt,
  Min,
  Max,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { BillingCycle } from '../schemas/subscription.schema';

export class QuerySubscriptionDto {
  @ApiPropertyOptional({
    description: 'Filter by subscription category',
    example: 'Entertainment',
  })
  @IsOptional()
  @IsString()
  category?: string;

  @ApiPropertyOptional({
    enum: BillingCycle,
    description: 'Filter by billing cycle',
    example: BillingCycle.MONTHLY,
  })
  @IsOptional()
  @IsEnum(BillingCycle)
  billingCycle?: BillingCycle;

  @ApiPropertyOptional({
    description: 'Filter by tags (comma-separated)',
    example: 'shared,essential',
  })
  @IsOptional()
  @IsString()
  tags?: string;

  @ApiPropertyOptional({
    enum: ['name', 'cost', 'nextBillingDate', 'createdAt'],
    description: 'Field to sort results by',
    example: 'cost',
  })
  @IsOptional()
  @IsIn(['name', 'cost', 'nextBillingDate', 'createdAt'])
  sortBy?: string;

  @ApiPropertyOptional({
    enum: ['asc', 'desc'],
    description: 'Sort direction',
    example: 'asc',
  })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc';

  @ApiPropertyOptional({
    description: 'Page number (1-indexed)',
    example: 1,
    minimum: 1,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({
    description: 'Number of results per page',
    example: 20,
    minimum: 0,
    maximum: 100,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  limit?: number;
}
