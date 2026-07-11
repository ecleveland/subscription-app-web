import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsMongoId,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  RecurringCadence,
  RecurringType,
} from '../schemas/recurring-transaction.schema';
import { ValidateIfDefined } from '../../common/validation/validate-if-defined';

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

  @ApiProperty({
    description:
      'Positive amount in integer minor units (cents); the sign of its effect ' +
      'is derived from `type`.',
    example: 1999,
    minimum: 1,
  })
  @IsInt()
  @Min(1)
  amountCents: number;

  // Trimmed before validation: the schema trims too, so an untrimmed
  // whitespace-only payee would pass @IsNotEmpty, trim to "" at save time, and
  // fail the schema's required check as a 500.
  @ApiProperty({ description: 'Payee / display name', example: 'Netflix' })
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim() : (value as unknown),
  )
  @IsString()
  @IsNotEmpty()
  payee: string;

  @ApiPropertyOptional({ description: 'Free-form notes' })
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiPropertyOptional({ type: [String], example: ['streaming'] })
  @IsOptional()
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
  @IsInt()
  @Min(0)
  @Max(30)
  reminderDaysBefore?: number;

  // Null is accepted and treated as "no end date" — the same nullable contract
  // the update DTO uses to clear it, kept identical on both verbs.
  @ApiPropertyOptional({
    description: 'Last date the schedule may run (ISO 8601); null = none',
  })
  @ValidateIf((o: CreateRecurringDto) => o.endDate !== null)
  @IsOptional()
  @IsDateString()
  endDate?: string | null;

  // Restore the raw request value: enableImplicitConversion coerces the string
  // "false" to boolean true before validation, so validate against the
  // pre-coercion value from the plain object — a string fails @IsBoolean.
  @ApiPropertyOptional({
    description: 'Pause/resume without deleting history',
    default: true,
  })
  @ValidateIfDefined
  @Transform(({ obj }) => (obj as Record<string, unknown>).isActive)
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({
    description:
      'Surface this schedule on the Subscriptions page (expenses only)',
    default: false,
  })
  @ValidateIfDefined
  @Transform(({ obj }) => (obj as Record<string, unknown>).isSubscription)
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
  @ValidateIf((o: CreateRecurringDto) => o.sharedWith !== null)
  @IsInt()
  @Min(2)
  @IsOptional()
  sharedWith?: number | null;
}
