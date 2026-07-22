import { IsBoolean, IsMongoId, IsOptional } from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class ReconcileQueryDto {
  @ApiPropertyOptional({
    description:
      'Reconcile only this household. Omit to sweep every household.',
    example: '507f191e810c19729de860ea',
  })
  @IsOptional()
  @IsMongoId()
  householdId?: string;

  @ApiPropertyOptional({
    description:
      'Report drift without correcting it (dry run). Defaults to false.',
    example: false,
    default: false,
  })
  @IsOptional()
  // Query params arrive as strings; coerce explicitly so "false" doesn't become
  // a truthy boolean under implicit conversion (cf. VEG-475).
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  dryRun?: boolean;
}
