import { ApiProperty } from '@nestjs/swagger';

// Response of DELETE /categories/:id: which fate the category met. A category
// referenced by any transaction or budget row is archived (history preserved);
// an unreferenced one is hard-deleted.
export class RemoveCategoryOutcomeDto {
  @ApiProperty({
    enum: ['archived', 'deleted'],
    description:
      "'archived' when the category is referenced by a transaction or budget " +
      "row; 'deleted' when it was unreferenced and hard-deleted",
  })
  outcome: 'archived' | 'deleted';
}
