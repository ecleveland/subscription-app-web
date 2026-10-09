import { ApiProperty } from '@nestjs/swagger';
import {
  IsString,
  Matches,
  Validate,
  ValidatorConstraint,
  ValidatorConstraintInterface,
  ValidationArguments,
} from 'class-validator';
import {
  isValidMonth,
  MONTH_FORMAT,
  MONTH_REGEX,
} from '../../budgets/budget-month.util';
import { monthIndex } from '../month-range.util';

// Upper bound on months per report request, inclusive of both ends. Keeps
// the per-month response and the aggregation scan bounded.
export const MAX_REPORT_MONTHS = 36;

// Inclusive month span from `from` to `to`, or null when either side is
// missing or malformed. The range checks pass on null so the caller sees the
// format error alone.
function spanOf(args: ValidationArguments): number | null {
  const { from, to } = args.object as MonthRangeQueryDto;
  if (
    typeof from !== 'string' ||
    typeof to !== 'string' ||
    !isValidMonth(from) ||
    !isValidMonth(to)
  ) {
    return null;
  }
  return monthIndex(to) - monthIndex(from) + 1;
}

@ValidatorConstraint({ name: 'fromNotAfterTo' })
class FromNotAfterToConstraint implements ValidatorConstraintInterface {
  validate(_to: unknown, args: ValidationArguments): boolean {
    const span = spanOf(args);
    return span === null || span >= 1;
  }

  defaultMessage(): string {
    return 'from must not be after to';
  }
}

@ValidatorConstraint({ name: 'maxReportMonths' })
class MaxMonthsConstraint implements ValidatorConstraintInterface {
  validate(_to: unknown, args: ValidationArguments): boolean {
    const span = spanOf(args);
    return span === null || span <= MAX_REPORT_MONTHS;
  }

  defaultMessage(): string {
    return `range must not exceed ${MAX_REPORT_MONTHS} months`;
  }
}

// The inclusive YYYY-MM range shared by the multi-month reports.
export class MonthRangeQueryDto {
  @ApiProperty({
    description: 'First month, inclusive (YYYY-MM)',
    example: '2026-01',
  })
  @IsString()
  @Matches(MONTH_REGEX, MONTH_FORMAT)
  from!: string;

  @ApiProperty({
    description: 'Last month, inclusive (YYYY-MM)',
    example: '2026-12',
  })
  @IsString()
  @Matches(MONTH_REGEX, MONTH_FORMAT)
  @Validate(FromNotAfterToConstraint)
  @Validate(MaxMonthsConstraint)
  to!: string;
}
