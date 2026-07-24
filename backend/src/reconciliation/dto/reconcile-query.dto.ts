import { IsBoolean, IsMongoId, IsOptional } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { TransformBooleanParam } from '../../common/validation/transform-raw-value';

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
  // Reads the raw pre-coercion value: under the global pipe's
  // enableImplicitConversion, a bare value-based transform sees "false" already
  // coerced to boolean true, which would turn ?dryRun=false into a dry run and
  // silently skip real corrections (VEG-475).
  @TransformBooleanParam
  @IsBoolean()
  dryRun?: boolean;
}
