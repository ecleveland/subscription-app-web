import {
  IsString,
  IsNotEmpty,
  IsEnum,
  IsInt,
  IsOptional,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AccountType } from '../schemas/account.schema';
import { TrimString } from '../../common/validation/transform-raw-value';

export class CreateAccountDto {
  @ApiProperty({ description: 'Account name', example: 'Everyday Checking' })
  @TrimString
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({
    enum: AccountType,
    description: 'Account type',
    example: AccountType.CHECKING,
  })
  @IsEnum(AccountType)
  type: AccountType;

  @ApiPropertyOptional({
    description:
      'Opening balance in integer minor units (cents). Credit/loan accounts ' +
      'use a negative value. Defaults to 0.',
    example: 125000,
    default: 0,
  })
  @IsInt()
  @IsOptional()
  balanceCents?: number;
}
