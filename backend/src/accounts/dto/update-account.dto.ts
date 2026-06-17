import { PartialType } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { CreateAccountDto } from './create-account.dto';

// All CreateAccountDto fields optional (validation preserved), plus the archive
// flag so an account can be archived/unarchived via update. Mirrors the
// UpdateSubscriptionDto extends PartialType(Create...) pattern.
export class UpdateAccountDto extends PartialType(CreateAccountDto) {
  @ApiPropertyOptional({
    description: 'Whether the account is archived (hidden from active lists)',
    example: false,
  })
  @IsBoolean()
  @IsOptional()
  isArchived?: boolean;
}
