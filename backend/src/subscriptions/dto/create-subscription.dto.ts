import {
  IsString,
  IsNotEmpty,
  IsNumber,
  IsEnum,
  IsDateString,
  IsOptional,
  IsBoolean,
  IsArray,
  Min,
  Max,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { BillingCycle } from '../schemas/subscription.schema';

export class CreateSubscriptionDto {
  @ApiProperty({ description: 'Name of the subscription', example: 'Netflix' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({
    description: 'Monthly or per-cycle cost',
    example: 15.99,
    minimum: 0,
  })
  @IsNumber()
  @Min(0)
  cost: number;

  @ApiProperty({
    enum: BillingCycle,
    description: 'How often the subscription is billed',
    example: BillingCycle.MONTHLY,
  })
  @IsEnum(BillingCycle)
  billingCycle: BillingCycle;

  @ApiProperty({
    description: 'Next billing date in ISO 8601 format',
    example: '2026-04-01',
  })
  @IsDateString()
  nextBillingDate: string;

  @ApiProperty({
    description: 'Subscription category',
    example: 'Entertainment',
  })
  @IsString()
  @IsNotEmpty()
  category: string;

  @ApiPropertyOptional({
    description: 'Additional notes about the subscription',
    example: 'Family plan',
  })
  @IsString()
  @IsOptional()
  notes?: string;

  @ApiPropertyOptional({
    description: 'Custom tags for organizing subscriptions',
    example: ['shared', 'essential'],
    type: [String],
  })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  tags?: string[];

  @ApiPropertyOptional({
    description: 'Whether the subscription is currently active',
    example: true,
    default: true,
  })
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  @ApiPropertyOptional({
    description:
      'Number of days before renewal to send a reminder (0 to disable)',
    example: 3,
    default: 3,
    minimum: 0,
    maximum: 30,
  })
  @IsNumber()
  @IsOptional()
  @Min(0)
  @Max(30)
  reminderDaysBefore?: number;
}
