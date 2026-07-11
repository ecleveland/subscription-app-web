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
  ValidateIf,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  RecurringCadence,
  RecurringType,
} from '../schemas/recurring-transaction.schema';
import { ValidateIfDefined } from '../../common/validation/validate-if-defined';

// Explicit class rather than PartialType(CreateRecurringDto): PartialType's
// @IsOptional skips explicit JSON null entirely, and a null on a
// required-in-schema field (payee, nextDate, …) would reach Mongoose as a
// required-path violation — a 500. Every field here uses ValidateIfDefined so
// null fails its validators as a 400 instead, except the two fields whose null
// is a deliberate contract: endDate (null clears the end date) and sharedWith
// (legacy null-to-clear, per the Subscription contract the schema preserves).
export class UpdateRecurringDto {
  @ApiPropertyOptional({
    description: 'Account the materialized transactions will post to',
  })
  @ValidateIfDefined
  @IsMongoId()
  accountId?: string;

  @ApiPropertyOptional({
    description: 'Category for the materialized transactions',
  })
  @ValidateIfDefined
  @IsMongoId()
  categoryId?: string;

  @ApiPropertyOptional({ enum: RecurringType })
  @ValidateIfDefined
  @IsEnum(RecurringType)
  type?: RecurringType;

  @ApiPropertyOptional({
    description: 'Positive amount in integer minor units (cents)',
    minimum: 1,
  })
  @ValidateIfDefined
  @IsInt()
  @Min(1)
  amountCents?: number;

  @ApiPropertyOptional({ description: 'Payee / display name' })
  @ValidateIfDefined
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim() : (value as unknown),
  )
  @IsString()
  @IsNotEmpty()
  payee?: string;

  @ApiPropertyOptional({ description: 'Free-form notes' })
  @ValidateIfDefined
  @IsString()
  notes?: string;

  @ApiPropertyOptional({ type: [String] })
  @ValidateIfDefined
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @ApiPropertyOptional({ enum: RecurringCadence })
  @ValidateIfDefined
  @IsEnum(RecurringCadence)
  cadence?: RecurringCadence;

  @ApiPropertyOptional({ description: 'Next occurrence (ISO 8601)' })
  @ValidateIfDefined
  @IsDateString()
  nextDate?: string;

  @ApiPropertyOptional({
    description: 'Days before nextDate to send a reminder',
    minimum: 0,
    maximum: 30,
  })
  @ValidateIfDefined
  @IsInt()
  @Min(0)
  @Max(30)
  reminderDaysBefore?: number;

  // Null-to-clear: without accepting null there is no way to remove an end
  // date once set (undefined means "unchanged").
  @ApiPropertyOptional({
    description: 'Last date the schedule may run; null clears it',
  })
  @ValidateIf(
    (_o: UpdateRecurringDto, value: unknown) =>
      value !== undefined && value !== null,
  )
  @IsDateString()
  endDate?: string | null;

  // Restore the raw request value: enableImplicitConversion coerces the string
  // "false" to boolean true before validation, so validate against the
  // pre-coercion value from the plain object — a string fails @IsBoolean.
  @ApiPropertyOptional({ description: 'Pause/resume without deleting history' })
  @ValidateIfDefined
  @Transform(({ obj }) => (obj as Record<string, unknown>).isActive)
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({
    description:
      'Surface this schedule on the Subscriptions page (expenses only)',
  })
  @ValidateIfDefined
  @Transform(({ obj }) => (obj as Record<string, unknown>).isSubscription)
  @IsBoolean()
  isSubscription?: boolean;

  // Legacy null-to-clear contract (mirrors UpdateSubscriptionDto).
  @ApiPropertyOptional({
    description:
      'Number of people sharing the cost; null clears sharing. Minimum 2.',
    minimum: 2,
  })
  @ValidateIf(
    (_o: UpdateRecurringDto, value: unknown) =>
      value !== undefined && value !== null,
  )
  @IsInt()
  @Min(2)
  sharedWith?: number | null;
}
