import {
  ArrayMaxSize,
  ArrayNotEmpty,
  ArrayUnique,
  IsArray,
  IsMongoId,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

// Batch-set display order (the body of POST /categories/reorder): each listed
// category gets sortOrder = its array index. A partial list is allowed —
// ordering is meaningful within a group, so the UI sends one group's ids at a
// time and unlisted categories keep their current sortOrder.
export class ReorderCategoriesDto {
  @ApiProperty({
    description: 'Category ids in the desired display order',
    type: [String],
  })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(500)
  @ArrayUnique()
  @IsMongoId({ each: true })
  categoryIds: string[];
}
