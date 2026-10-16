import { OmitType, PartialType } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { CreateAccountDto } from './create-account.dto';

// CreateAccountDto's name and type, optional with validation preserved, plus
// the archive flag so an account can be archived/unarchived via update.
// balanceCents is omitted: after create, the balance moves only through the
// ledger (applyBalanceDelta) and reconciliation, so the global pipe's
// forbidNonWhitelisted rejects it on PATCH with a 400.
export class UpdateAccountDto extends PartialType(
  OmitType(CreateAccountDto, ['balanceCents'] as const),
) {
  @ApiPropertyOptional({
    description: 'Whether the account is archived (hidden from active lists)',
    example: false,
  })
  @IsBoolean()
  @IsOptional()
  isArchived?: boolean;
}
