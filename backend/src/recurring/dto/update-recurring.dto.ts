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
import { ApiPropertyOptional } from '@nestjs/swagger';
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

// Explicit class rather than PartialType(CreateRecurringDto): PartialType's
// @IsOptional skips explicit JSON null entirely, and a null slipping through
// misbehaves per field — on a required-in-schema path (payee) it's a Mongoose
// required-path violation surfacing as a 500, on cadence a failed enum cast,
// on nextDate silently persisting the epoch (new Date(null)). Every field here
// uses ValidateIfDefined so null fails its validators as a 400 instead, except
// the two fields whose null is a deliberate contract: endDate (null clears the
// end date) and sharedWith (legacy null-to-clear, per the Subscription
// contract the schema preserves).
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

  // TransformRawValue on the numeric fields: implicit conversion turns a
  // stray JSON boolean into Number(true) === 1, which would pass @IsInt
  // @Min(1) and rewrite a real bill to 1 cent.
  @ApiPropertyOptional({
    description: 'Positive amount in integer minor units (cents)',
    minimum: 1,
  })
  @ValidateIfDefined
  @TransformRawValue
  @IsInt()
  @Min(1)
  amountCents?: number;

  @ApiPropertyOptional({ description: 'Payee / display name' })
  @ValidateIfDefined
  @TrimString
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
  @TransformRawValue
  @IsInt()
  @Min(0)
  @Max(30)
  reminderDaysBefore?: number;

  // Null-to-clear: without accepting null there is no way to remove an end
  // date once set (undefined means "unchanged").
  @ApiPropertyOptional({
    description: 'Last date the schedule may run; null clears it',
  })
  @ValidateIfNotNullish
  @IsDateString()
  endDate?: string | null;

  @ApiPropertyOptional({ description: 'Pause/resume without deleting history' })
  @ValidateIfDefined
  @TransformRawValue
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({
    description:
      'Surface this schedule on the Subscriptions page (expenses only)',
  })
  @ValidateIfDefined
  @TransformRawValue
  @IsBoolean()
  isSubscription?: boolean;

  // Legacy null-to-clear contract (mirrors UpdateSubscriptionDto).
  @ApiPropertyOptional({
    description:
      'Number of people sharing the cost; null clears sharing. Minimum 2.',
    minimum: 2,
  })
  @ValidateIfNotNullish
  @TransformRawValue
  @IsInt()
  @Min(2)
  sharedWith?: number | null;
}
