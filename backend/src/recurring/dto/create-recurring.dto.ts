import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsMongoId,
  IsNotEmpty,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  RecurringCadence,
  RecurringType,
} from '../schemas/recurring-transaction.schema';
import { ValidateIfDefined } from '../../common/validation/validate-if-defined';
import { ValidateIfNotNullish } from '../../common/validation/validate-if-not-nullish';
import {
  TransformRawValue,
  TrimString,
} from '../../common/validation/transform-raw-value';

export class CreateRecurringDto {
  // Required here even though the schema prop is optional: only migrated
  // legacy subscriptions (VEG-469) may lack an account — every API-created
  // schedule posts somewhere, so the scheduler never has to skip it.
  @ApiProperty({
    description: 'Account the materialized transactions will post to',
  })
  @IsMongoId()
  accountId: string;

  @ApiProperty({ description: 'Category for the materialized transactions' })
  @IsMongoId()
  categoryId: string;

  @ApiProperty({ enum: RecurringType, example: RecurringType.EXPENSE })
  @IsEnum(RecurringType)
  type: RecurringType;

  // TransformRawValue on the numeric fields: implicit conversion turns a
  // stray JSON boolean into Number(true) === 1, which would pass @IsInt
  // @Min(1) and persist a 1-cent schedule.
  @ApiProperty({
    description:
      'Positive amount in integer minor units (cents); the sign of its effect ' +
      'is derived from `type`.',
    example: 1999,
    minimum: 1,
  })
  @TransformRawValue
  @IsInt()
  @Min(1)
  amountCents: number;

  @ApiProperty({ description: 'Payee / display name', example: 'Netflix' })
  @TrimString
  @IsString()
  @IsNotEmpty()
  payee: string;

  // ValidateIfDefined, not @IsOptional: explicit null would skip @IsOptional
  // validation entirely and persist (the schema defaults only apply to
  // undefined) — reject it like the update DTO does.
  @ApiPropertyOptional({ description: 'Free-form notes' })
  @ValidateIfDefined
  @IsString()
  notes?: string;

  @ApiPropertyOptional({ type: [String], example: ['streaming'] })
  @ValidateIfDefined
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @ApiProperty({ enum: RecurringCadence, example: RecurringCadence.MONTHLY })
  @IsEnum(RecurringCadence)
  cadence: RecurringCadence;

  @ApiProperty({
    description: 'Next occurrence (ISO 8601)',
    example: '2026-08-01',
  })
  @IsDateString()
  nextDate: string;

  // ValidateIfDefined, not @IsOptional: the schema hard-rejects explicit null
  // (it would break the reminder cron's date math), so null must fail here as
  // a 400 rather than reach Mongoose as a 500.
  @ApiPropertyOptional({
    description: 'Days before nextDate to send a reminder',
    minimum: 0,
    maximum: 30,
    default: 3,
  })
  @ValidateIfDefined
  @TransformRawValue
  @IsInt()
  @Min(0)
  @Max(30)
  reminderDaysBefore?: number;

  // Null is accepted and treated as "no end date" — the same nullable contract
  // the update DTO uses to clear it, kept identical on both verbs.
  @ApiPropertyOptional({
    description: 'Last date the schedule may run (ISO 8601); null = none',
  })
  @ValidateIfNotNullish
  @IsDateString()
  endDate?: string | null;

  @ApiPropertyOptional({
    description: 'Pause/resume without deleting history',
    default: true,
  })
  @ValidateIfDefined
  @TransformRawValue
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({
    description:
      'Surface this schedule on the Subscriptions page (expenses only)',
    default: false,
  })
  @ValidateIfDefined
  @TransformRawValue
  @IsBoolean()
  isSubscription?: boolean;

  // Legacy Subscription contract: explicit null passes ("not shared"), kept
  // for VEG-469 API compatibility. Mirrors create-subscription.dto.ts.
  @ApiPropertyOptional({
    description:
      'Number of people sharing the cost (including the user). Minimum 2.',
    example: 3,
    minimum: 2,
  })
  @ValidateIfNotNullish
  @TransformRawValue
  @IsInt()
  @Min(2)
  sharedWith?: number | null;
}
