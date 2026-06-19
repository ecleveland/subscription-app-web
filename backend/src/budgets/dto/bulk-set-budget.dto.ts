import {
  IsArray,
  IsInt,
  IsMongoId,
  Min,
  ValidateNested,
  ArrayMaxSize,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

// One category limit within a bulk set. `categoryId` is validated as a Mongo id
// here; that it belongs to the caller's household is checked in the service.
export class BulkBudgetCategoryLimitDto {
  @ApiProperty({ description: 'Category to set a planned limit for' })
  @IsMongoId()
  categoryId: string;

  @ApiProperty({
    description: 'Planned monthly limit in integer minor units (cents)',
    example: 50000,
    minimum: 0,
  })
  @IsInt()
  @Min(0)
  plannedCents: number;
}

// Body of the optional bulk `PUT /budgets/:month`: upsert several category
// limits in one call. This is additive (it upserts the listed categories only,
// not a full replace) — clear a limit with DELETE. An upper bound keeps a single
// request from issuing an unbounded write batch.
export class BulkSetBudgetDto {
  @ApiProperty({ type: [BulkBudgetCategoryLimitDto] })
  @IsArray()
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => BulkBudgetCategoryLimitDto)
  categories: BulkBudgetCategoryLimitDto[];
}
