import {
  IsDateString,
  IsEnum,
  IsInt,
  IsMongoId,
  IsNotEmpty,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { GoalType } from '../schemas/goal.schema';
import {
  TransformRawValue,
  TrimString,
} from '../../common/validation/transform-raw-value';

// currentCents is deliberately absent. It starts at 0 and only moves through
// POST /goals/:id/contributions.
export class CreateGoalDto {
  @ApiProperty({ description: 'Goal name', example: 'Emergency fund' })
  // Trimmed first so a whitespace-only name is a 400, not a save-time 500.
  @TrimString
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({
    enum: GoalType,
    description:
      'savings counts up toward the target. debt also counts up, with the ' +
      'target set to the starting balance owed.',
    example: GoalType.SAVINGS,
  })
  @IsEnum(GoalType)
  type: GoalType;

  @ApiProperty({
    description: 'Target in integer minor units (cents), at least 1',
    example: 1000000,
    minimum: 1,
  })
  // Raw value so implicit conversion cannot turn true or "5000" into a number.
  @TransformRawValue
  @IsInt()
  @Min(1)
  targetCents: number;

  @ApiPropertyOptional({
    description: 'Target date in ISO 8601 format',
    example: '2027-06-01',
  })
  @IsOptional()
  @IsDateString()
  targetDate?: string;

  @ApiPropertyOptional({
    description: 'Category in the same household this goal relates to',
    example: '665f1c2e9b3a4d5e6f708192',
  })
  @IsOptional()
  @IsMongoId()
  categoryId?: string;
}
