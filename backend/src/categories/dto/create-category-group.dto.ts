import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

// Creates a category group in the caller's household (the body of
// POST /categories/groups). Name trimmed pre-validation for the same
// whitespace-name reason as CreateCategoryDto.
export class CreateCategoryGroupDto {
  @ApiProperty({ description: 'Group name', example: 'Pets' })
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim() : (value as unknown),
  )
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;

  @ApiPropertyOptional({
    description:
      'Display position; appended after the household’s last group if omitted',
    minimum: 0,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}
