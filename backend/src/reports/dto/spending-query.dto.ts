import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Matches } from 'class-validator';
import { MONTH_FORMAT, MONTH_REGEX } from '../../budgets/budget-month.util';
import {
  LABEL_FILTER_MESSAGE,
  LABEL_FILTER_PATTERN,
} from '../../labels/dto/label-filter';

export class SpendingQueryDto {
  @ApiProperty({ description: 'Month to report (YYYY-MM)', example: '2026-03' })
  @IsString()
  @Matches(MONTH_REGEX, MONTH_FORMAT)
  month!: string;

  @ApiPropertyOptional({
    description:
      "Filter by business label: a label id (with its sub-labels), 'none' for personal only, or 'any' for every labeled record",
  })
  @IsOptional()
  @Matches(LABEL_FILTER_PATTERN, { message: LABEL_FILTER_MESSAGE })
  labelId?: string;
}
