import {
  IsBoolean,
  IsInt,
  IsMongoId,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

// Creates a category in the caller's household (the body of POST /categories).
// The name is trimmed here, before validation, so an all-whitespace name fails
// @IsNotEmpty with a 400 instead of surfacing as a 500 when the schema's
// trim+required reduces it to "" at save time.
export class CreateCategoryDto {
  @ApiProperty({ description: 'Category name', example: 'Coffee' })
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim() : (value as unknown),
  )
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;

  @ApiProperty({
    description: 'CategoryGroup (in the same household) to file it under',
  })
  @IsMongoId()
  groupId: string;

  @ApiPropertyOptional({
    description: 'Income category (paychecks) vs expense',
    default: false,
  })
  @IsOptional()
  // Restore the raw request value: enableImplicitConversion coerces the string
  // "false" to boolean true before validation, so validate against the
  // pre-coercion value from the plain object — a string fails @IsBoolean.
  @Transform(({ obj }) => (obj as Record<string, unknown>).isIncome)
  @IsBoolean()
  isIncome?: boolean;

  @ApiPropertyOptional({
    description:
      'Display position; appended to the end of the group if omitted',
    minimum: 0,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}
