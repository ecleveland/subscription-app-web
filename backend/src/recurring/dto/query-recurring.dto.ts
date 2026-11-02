import {
  IsBoolean,
  IsEnum,
  IsMongoId,
  IsOptional,
  Matches,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { RecurringType } from '../schemas/recurring-transaction.schema';
import { TransformBooleanParam } from '../../common/validation/transform-raw-value';
import {
  LABEL_FILTER_MESSAGE,
  LABEL_FILTER_PATTERN,
} from '../../labels/dto/label-filter';

export class QueryRecurringDto {
  @ApiPropertyOptional({ enum: RecurringType })
  @IsOptional()
  @IsEnum(RecurringType)
  type?: RecurringType;

  @ApiPropertyOptional({ description: 'Filter by account' })
  @IsOptional()
  @IsMongoId()
  accountId?: string;

  @ApiPropertyOptional({ description: 'Filter by category' })
  @IsOptional()
  @IsMongoId()
  categoryId?: string;

  @ApiPropertyOptional({
    description:
      "Filter by business label: a label id, or 'none' for personal records",
  })
  @IsOptional()
  @Matches(LABEL_FILTER_PATTERN, { message: LABEL_FILTER_MESSAGE })
  labelId?: string;

  @ApiPropertyOptional({
    description: 'Only subscriptions (true) or only non-subscriptions (false)',
  })
  @IsOptional()
  @TransformBooleanParam
  @IsBoolean()
  isSubscription?: boolean;

  @ApiPropertyOptional({
    description: 'Only active (true) or only paused (false) schedules',
  })
  @IsOptional()
  @TransformBooleanParam
  @IsBoolean()
  isActive?: boolean;
}
