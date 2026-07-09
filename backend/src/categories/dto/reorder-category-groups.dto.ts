import {
  ArrayMaxSize,
  ArrayNotEmpty,
  ArrayUnique,
  IsArray,
  IsMongoId,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

// Batch-set group display order (the body of POST /categories/groups/reorder):
// each listed group gets sortOrder = its array index. A partial list is
// allowed; unlisted groups keep their current sortOrder. Mirrors
// ReorderCategoriesDto.
export class ReorderCategoryGroupsDto {
  @ApiProperty({
    description: 'Category-group ids in the desired display order',
    type: [String],
  })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(500)
  @ArrayUnique()
  @IsMongoId({ each: true })
  groupIds: string[];
}
