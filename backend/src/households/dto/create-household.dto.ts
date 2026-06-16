import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsISO4217CurrencyCode,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateHouseholdDto {
  @ApiProperty({
    description: 'Display name of the household',
    example: 'The Cleveland Family',
  })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiPropertyOptional({
    description: 'ISO 4217 currency code for the household (default USD)',
    example: 'USD',
    default: 'USD',
  })
  @IsISO4217CurrencyCode()
  @IsOptional()
  currency?: string;
}
