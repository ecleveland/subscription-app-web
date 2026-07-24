import { IsBoolean, IsOptional } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { TransformBooleanParam } from '../../common/validation/transform-raw-value';

export class QueryAccountDto {
  @ApiPropertyOptional({
    description: 'Include archived accounts in the list (default false)',
    example: false,
    default: false,
  })
  @IsOptional()
  // Reads the raw pre-coercion value: under the global pipe's
  // enableImplicitConversion, a bare value-based transform sees "false" already
  // coerced to boolean true, inverting ?includeArchived=false (VEG-475).
  @TransformBooleanParam
  @IsBoolean()
  includeArchived?: boolean;
}
