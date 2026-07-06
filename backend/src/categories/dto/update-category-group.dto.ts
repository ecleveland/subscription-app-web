import { IsInt, IsNotEmpty, IsString, MaxLength, Min } from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { ValidateIfDefined } from '../../common/validation/validate-if-defined';

// Partial update: rename and/or reorder a group (PATCH /categories/groups/:id).
// Fields use ValidateIfDefined so an explicit JSON null fails with 400 instead
// of surfacing as a Mongoose required-path 500 (see UpdateCategoryDto).
export class UpdateCategoryGroupDto {
  @ApiPropertyOptional({ description: 'Group name', example: 'Pets' })
  @ValidateIfDefined
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim() : (value as unknown),
  )
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name?: string;

  @ApiPropertyOptional({ description: 'Display position', minimum: 0 })
  @ValidateIfDefined
  @IsInt()
  @Min(0)
  sortOrder?: number;
}
