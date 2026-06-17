import { IsBoolean, IsOptional } from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class QueryAccountDto {
  @ApiPropertyOptional({
    description: 'Include archived accounts in the list (default false)',
    example: false,
    default: false,
  })
  @IsOptional()
  // Query params arrive as strings; coerce explicitly so "false" doesn't become
  // a truthy boolean under implicit conversion.
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  includeArchived?: boolean;
}
