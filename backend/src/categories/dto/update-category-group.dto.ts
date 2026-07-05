import {
  IsInt,
  IsNotEmpty,
  IsString,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

// Skip validation only when the field is absent; an explicit JSON null must
// FAIL the validators (400) rather than skip them (see UpdateCategoryDto).
const defined = ValidateIf((_object, value) => value !== undefined);

// Partial update: rename and/or reorder a group (PATCH /categories/groups/:id).
export class UpdateCategoryGroupDto {
  @ApiPropertyOptional({ description: 'Group name', example: 'Pets' })
  @defined
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim() : (value as unknown),
  )
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name?: string;

  @ApiPropertyOptional({ description: 'Display position', minimum: 0 })
  @defined
  @IsInt()
  @Min(0)
  sortOrder?: number;
}
