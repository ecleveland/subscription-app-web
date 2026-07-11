import { IsBoolean, IsEnum, IsMongoId, IsOptional } from 'class-validator';
import { Transform, TransformFnParams } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { RecurringType } from '../schemas/recurring-transaction.schema';

// Map a boolean-ish query-param literal to a boolean; return anything else
// unchanged so @IsBoolean rejects it with a 400. Reads the RAW value off the
// plain object (class-transformer supplies the property key) because
// enableImplicitConversion coerces the string "false" to boolean true before
// a value-based transform would run.
function coerceBooleanParam({ obj, key }: TransformFnParams): unknown {
  const raw = (obj as Record<string, unknown>)[key];
  if (raw === true || raw === 'true') return true;
  if (raw === false || raw === 'false') return false;
  return raw;
}

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
    description: 'Only subscriptions (true) or only non-subscriptions (false)',
  })
  @IsOptional()
  @Transform(coerceBooleanParam)
  @IsBoolean()
  isSubscription?: boolean;

  @ApiPropertyOptional({
    description: 'Only active (true) or only paused (false) schedules',
  })
  @IsOptional()
  @Transform(coerceBooleanParam)
  @IsBoolean()
  isActive?: boolean;
}
