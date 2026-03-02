import { IsOptional, IsString, IsEnum, IsIn, IsInt, Min, Max } from 'class-validator';
import { BillingCycle } from '../schemas/subscription.schema';

export class QuerySubscriptionDto {
  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsEnum(BillingCycle)
  billingCycle?: BillingCycle;

  @IsOptional()
  @IsIn(['name', 'cost', 'nextBillingDate', 'createdAt'])
  sortBy?: string;

  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc';

  @IsOptional()
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  limit?: number;
}
