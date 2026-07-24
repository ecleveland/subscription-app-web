import { IsOptional, IsBoolean } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { TransformBooleanParam } from '../../common/validation/transform-raw-value';

export class QueryNotificationDto {
  @ApiPropertyOptional({ description: 'Filter by read status' })
  @IsOptional()
  // Reads the raw pre-coercion value: under the global pipe's
  // enableImplicitConversion, a bare @IsBoolean sees "false" already coerced to
  // boolean true, inverting ?read=false (VEG-475).
  @TransformBooleanParam
  @IsBoolean()
  read?: boolean;
}
