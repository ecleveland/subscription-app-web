import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsMongoId,
  IsNotEmpty,
  IsString,
  Min,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { GoalType } from '../schemas/goal.schema';
import { ValidateIfDefined } from '../../common/validation/validate-if-defined';
import { ValidateIfNotNullish } from '../../common/validation/validate-if-not-nullish';
import {
  TransformRawValue,
  TrimString,
} from '../../common/validation/transform-raw-value';

// Every field optional. Required schema fields use ValidateIfDefined so a null
// is a 400, not a Mongoose error. targetDate and categoryId accept null to
// clear them. currentCents is not here, so the global pipe rejects it.
// Numeric and boolean fields read the raw value and name is trimmed, for the
// same reasons as in CreateGoalDto.
export class UpdateGoalDto {
  @ApiPropertyOptional({ example: 'Emergency fund' })
  @ValidateIfDefined
  @TrimString
  @IsString()
  @IsNotEmpty()
  name?: string;

  @ApiPropertyOptional({ enum: GoalType })
  @ValidateIfDefined
  @IsEnum(GoalType)
  type?: GoalType;

  @ApiPropertyOptional({ example: 1000000, minimum: 1 })
  @ValidateIfDefined
  @TransformRawValue
  @IsInt()
  @Min(1)
  targetCents?: number;

  @ApiPropertyOptional({
    description: 'ISO 8601 date, or null to clear',
    example: '2027-06-01',
    nullable: true,
  })
  @ValidateIfNotNullish
  @IsDateString()
  targetDate?: string | null;

  @ApiPropertyOptional({
    description: 'Category in the same household, or null to clear',
    nullable: true,
  })
  @ValidateIfNotNullish
  @IsMongoId()
  categoryId?: string | null;

  @ApiPropertyOptional({
    description: 'Hide the goal from the default list',
    example: true,
  })
  @ValidateIfDefined
  // Raw value so the string "false" is a 400 instead of coercing to true.
  @TransformRawValue
  @IsBoolean()
  isArchived?: boolean;
}
