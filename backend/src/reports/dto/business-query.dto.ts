import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsMongoId, IsOptional } from 'class-validator';
import { MonthRangeQueryDto } from './month-range-query.dto';

// Query for GET /api/reports/business. The shared report month range plus an
// optional label. The report only covers labeled money, so 'none' and 'any'
// are not accepted here and an omitted label means every label.
export class BusinessQueryDto extends MonthRangeQueryDto {
  @ApiPropertyOptional({
    description:
      'Business label id. The report includes its sub-labels. Omit for every label.',
  })
  @IsOptional()
  @IsMongoId()
  labelId?: string;
}
