import {
  IsMongoId,
  IsNotEmpty,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { TrimString } from '../../common/validation/transform-raw-value';
import { ValidateIfNotNullish } from '../../common/validation/validate-if-not-nullish';

export const LABEL_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;
export const LABEL_COLOR_MESSAGE = 'color must be a hex color like #336699';

// Creates a label in the caller's household (the body of POST /labels). The
// name is trimmed before validation so an all-whitespace name fails
// @IsNotEmpty with a 400 instead of reaching the schema's trim+required as a
// 500.
export class CreateLabelDto {
  @ApiProperty({ description: 'Label name', example: 'Consulting' })
  @TrimString
  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  name: string;

  @ApiProperty({ description: 'Hex color (#rrggbb)', example: '#336699' })
  @IsString()
  @Matches(LABEL_COLOR_PATTERN, { message: LABEL_COLOR_MESSAGE })
  color: string;

  @ApiPropertyOptional({
    description: 'Parent label in the same household; null or omit for none',
    nullable: true,
  })
  @ValidateIfNotNullish
  @IsMongoId()
  parentId?: string | null;
}
