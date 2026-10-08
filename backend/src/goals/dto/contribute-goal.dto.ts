import { IsInt, NotEquals } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { TransformRawValue } from '../../common/validation/transform-raw-value';

export class ContributeGoalDto {
  @ApiProperty({
    description:
      'Amount to add to currentCents, in integer minor units. Negative ' +
      'values correct an earlier contribution. Zero is rejected.',
    example: 5000,
  })
  // Raw value so implicit conversion cannot turn true or "5000" into a number.
  @TransformRawValue
  @IsInt()
  @NotEquals(0)
  amountCents: number;
}
