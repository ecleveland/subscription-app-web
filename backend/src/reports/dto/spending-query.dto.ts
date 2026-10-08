import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches } from 'class-validator';
import { MONTH_REGEX } from '../../budgets/budget-month.util';
import { MONTH_FORMAT } from './cash-flow-query.dto';

export class SpendingQueryDto {
  @ApiProperty({ description: 'Month to report (YYYY-MM)', example: '2026-03' })
  @IsString()
  @Matches(MONTH_REGEX, MONTH_FORMAT)
  month!: string;
}
