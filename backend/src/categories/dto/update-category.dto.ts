import {
  IsBoolean,
  IsInt,
  IsMongoId,
  IsNotEmpty,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { ValidateIfDefined } from '../../common/validation/validate-if-defined';

// Partial update: rename, move group, reorder, archive/un-archive. Explicit
// class rather than PartialType(CreateCategoryDto): the field set differs
// (no isIncome — flipping it on a category with ledger history would silently
// reclassify historical actuals in every budget view; adds isArchived), and
// every field uses ValidateIfDefined so an explicit JSON null fails with 400
// instead of reaching Mongoose as a required-path violation (a 500).
// (PartialType could match the null behavior via { skipNullProperties: false },
// but not the field shape.) With the global ValidationPipe's
// forbidNonWhitelisted, a PATCH sending isIncome is rejected with 400.
export class UpdateCategoryDto {
  @ApiPropertyOptional({ description: 'Category name', example: 'Coffee' })
  @ValidateIfDefined
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
  @ValidateIfDefined
  @IsMongoId()
  groupId?: string;

  @ApiPropertyOptional({ description: 'Display position', minimum: 0 })
  @ValidateIfDefined
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @ApiPropertyOptional({
    description:
      'Archive (true) or restore (false). Archived categories keep their ' +
      'ledger history and stay visible via includeArchived=true.',
  })
  @ValidateIfDefined
  // Restore the raw request value: enableImplicitConversion coerces the string
  // "false" to boolean true before validation, so validate against the
  // pre-coercion value from the plain object — a string fails @IsBoolean.
  @Transform(({ obj }) => (obj as Record<string, unknown>).isArchived)
  @IsBoolean()
  isArchived?: boolean;
}
