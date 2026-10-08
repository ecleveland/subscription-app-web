import { IsBoolean, IsOptional } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { TransformBooleanParam } from '../../common/validation/transform-raw-value';

export class QueryGoalDto {
  @ApiPropertyOptional({
    description: 'Include archived goals in the list (default false)',
    example: false,
    default: false,
  })
  @IsOptional()
  // Reads the raw string so ?includeArchived=false stays false under implicit
  // conversion (VEG-475).
  @TransformBooleanParam
  @IsBoolean()
  includeArchived?: boolean;
}
