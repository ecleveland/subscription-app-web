import {
  IsBoolean,
  IsMongoId,
  IsNotEmpty,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { ValidateIfDefined } from '../../common/validation/validate-if-defined';
import { ValidateIfNotNullish } from '../../common/validation/validate-if-not-nullish';
import {
  TransformRawValue,
  TrimString,
} from '../../common/validation/transform-raw-value';
import { LABEL_COLOR_MESSAGE, LABEL_COLOR_PATTERN } from './create-label.dto';

// Partial update: rename, recolor, re-parent, archive or restore. Explicit
// class rather than PartialType(CreateLabelDto) so an explicit JSON null on a
// required field fails with 400 (ValidateIfDefined) instead of reaching
// Mongoose as a 500. parentId is the one field where null is the contract: it
// clears the parent.
export class UpdateLabelDto {
  @ApiPropertyOptional({ description: 'Label name', example: 'Consulting' })
  @ValidateIfDefined
  @TrimString
  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  name?: string;

  @ApiPropertyOptional({ description: 'Hex color (#rrggbb)' })
  @ValidateIfDefined
  @IsString()
  @Matches(LABEL_COLOR_PATTERN, { message: LABEL_COLOR_MESSAGE })
  color?: string;

  @ApiPropertyOptional({
    description: 'Parent label in the same household, or null to clear',
    nullable: true,
  })
  @ValidateIfNotNullish
  @IsMongoId()
  parentId?: string | null;

  @ApiPropertyOptional({
    description:
      'Archive (true) or restore (false). Archived labels keep their ' +
      'references and stay visible via includeArchived=true.',
  })
  @ValidateIfDefined
  @TransformRawValue
  @IsBoolean()
  isArchived?: boolean;
}
