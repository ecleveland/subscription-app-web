import { IsInt, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

// Sets the planned monthly limit for a single category (the body of
// `PUT /budgets/:month/categories/:categoryId`). `plannedCents` is integer
// minor units, mirroring the BudgetCategory schema constraint — the DTO is the
// first gate, the schema validator the second.
export class SetBudgetCategoryDto {
  @ApiProperty({
    description: 'Planned monthly limit in integer minor units (cents)',
    example: 50000,
    minimum: 0,
  })
  @IsInt()
  @Min(0)
  plannedCents: number;
}
