import { ApiProperty } from '@nestjs/swagger';

// Response of DELETE /labels/:id: which fate the label met. A label referenced
// by any transaction, recurring template or goal is archived so those records
// keep their labelId; an unreferenced one is hard-deleted.
export class RemoveLabelOutcomeDto {
  @ApiProperty({
    enum: ['archived', 'deleted'],
    description:
      "'archived' when a transaction, recurring template or goal references " +
      "the label; 'deleted' when it was unreferenced and hard-deleted",
  })
  outcome: 'archived' | 'deleted';
}
