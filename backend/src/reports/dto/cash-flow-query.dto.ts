import { ApiProperty } from '@nestjs/swagger';
import {
  IsString,
  Matches,
  Validate,
  ValidatorConstraint,
  ValidatorConstraintInterface,
  ValidationArguments,
} from 'class-validator';
import { isValidMonth, MONTH_REGEX } from '../../budgets/budget-month.util';
import { monthIndex } from '../month-range.util';

// Upper bound on months per cash flow request, inclusive of both ends. Keeps
// the zero-filled response and the aggregation scan bounded.
export const MAX_CASH_FLOW_MONTHS = 36;

// Inclusive month span from `from` to `to`, or null when either side is
// missing or malformed. The range checks pass on null so the caller sees the
// format error alone.
function spanOf(args: ValidationArguments): number | null {
  const { from, to } = args.object as CashFlowQueryDto;
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

@ValidatorConstraint({ name: 'maxCashFlowMonths' })
class MaxMonthsConstraint implements ValidatorConstraintInterface {
  validate(_to: unknown, args: ValidationArguments): boolean {
    const span = spanOf(args);
    return span === null || span <= MAX_CASH_FLOW_MONTHS;
  }

  defaultMessage(): string {
    return `range must not exceed ${MAX_CASH_FLOW_MONTHS} months`;
  }
}

export const MONTH_FORMAT = {
  message: '$property must be a month in YYYY-MM format',
};

export class CashFlowQueryDto {
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
