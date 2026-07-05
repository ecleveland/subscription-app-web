import {
  IsBoolean,
  IsInt,
  IsMongoId,
  IsNotEmpty,
  IsString,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

// Skip validation only when the field is absent; an explicit JSON null must
// FAIL the field's validators (400), not skip them the way @IsOptional would —
// a skipped null reaches Mongoose's required-path validation and surfaces as a
// 500. This is why the class is explicit rather than PartialType(Create…):
// PartialType applies @IsOptional, which waves null through.
const defined = ValidateIf((_object, value) => value !== undefined);

// Partial update: rename, move group, reorder, archive/un-archive. `isIncome`
// is deliberately absent — flipping it on a category with ledger history would
// silently reclassify historical actuals in every budget view. With the global
// ValidationPipe's forbidNonWhitelisted, a PATCH sending it is a 400.
export class UpdateCategoryDto {
  @ApiPropertyOptional({ description: 'Category name', example: 'Coffee' })
  @defined
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim() : (value as unknown),
  )
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name?: string;

  @ApiPropertyOptional({
    description: 'Move to this CategoryGroup (in the same household)',
  })
  @defined
  @IsMongoId()
  groupId?: string;

  @ApiPropertyOptional({ description: 'Display position', minimum: 0 })
  @defined
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @ApiPropertyOptional({
    description:
      'Archive (true) or restore (false). Archived categories keep their ' +
      'ledger history and stay visible via includeArchived=true.',
  })
  @defined
  @IsBoolean()
  isArchived?: boolean;
}
