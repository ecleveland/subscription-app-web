import { OmitType, PartialType } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { CreateAccountDto } from './create-account.dto';
import { ValidateIfDefined } from '../../common/validation/validate-if-defined';
import { TransformRawValue } from '../../common/validation/transform-raw-value';

// CreateAccountDto's name and type, optional with validation preserved, plus
// the archive flag so an account can be archived/unarchived via update.
// balanceCents is omitted. After create, the balance moves only through the
// ledger (applyBalanceDelta) and reconciliation, so the global pipe's
// forbidNonWhitelisted rejects it on PATCH with a 400. skipNullProperties:
// false makes an explicit JSON null fail validation as a 400 instead of
// reaching Mongoose's required check as a 500.
export class UpdateAccountDto extends PartialType(
  OmitType(CreateAccountDto, ['balanceCents'] as const),
  { skipNullProperties: false },
) {
  @ApiPropertyOptional({
    description: 'Whether the account is archived (hidden from active lists)',
    example: false,
  })
  @ValidateIfDefined
  // Raw value so the string "false" is a 400 instead of coercing to true.
  @TransformRawValue
  @IsBoolean()
  isArchived?: boolean;
}
