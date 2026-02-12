import {
  IsString,
  IsNotEmpty,
  IsNumber,
  IsEnum,
  IsDateString,
  IsOptional,
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
}
