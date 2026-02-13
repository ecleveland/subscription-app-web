import {
  IsString,
  IsNotEmpty,
  IsNumber,
  IsEnum,
  IsDateString,
  IsOptional,
  IsBoolean,
  Min,
} from 'class-validator';
import { BillingCycle } from '../schemas/subscription.schema';

export class CreateSubscriptionDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsNumber()
  @Min(0)
  cost: number;

  @IsEnum(BillingCycle)
  billingCycle: BillingCycle;

  @IsDateString()
  nextBillingDate: string;

  @IsString()
  @IsNotEmpty()
  category: string;

  @IsString()
  @IsOptional()
  notes?: string;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}
