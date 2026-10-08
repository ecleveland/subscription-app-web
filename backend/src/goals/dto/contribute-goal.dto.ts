import { IsInt, NotEquals } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ContributeGoalDto {
  @ApiProperty({
    description:
      'Amount to add to currentCents, in integer minor units. Negative ' +
      'values correct an earlier contribution. Zero is rejected.',
    example: 5000,
  })
  @IsInt()
  @NotEquals(0)
  amountCents: number;
}
