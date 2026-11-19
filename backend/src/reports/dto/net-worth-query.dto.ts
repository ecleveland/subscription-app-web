import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, Matches } from 'class-validator';
import {
  LABEL_FILTER_MESSAGE,
  LABEL_FILTER_PATTERN,
} from '../../labels/dto/label-filter';
import { MonthRangeQueryDto } from './month-range-query.dto';

// Query for GET /api/reports/net-worth. The shared report month range plus
// an optional label filter.
export class NetWorthQueryDto extends MonthRangeQueryDto {
  @ApiPropertyOptional({
    description:
      "Filter by business label: a label id (with its sub-labels), 'none' for personal only, or 'any' for every labeled record",
  })
  @IsOptional()
  @Matches(LABEL_FILTER_PATTERN, { message: LABEL_FILTER_MESSAGE })
  labelId?: string;
}
