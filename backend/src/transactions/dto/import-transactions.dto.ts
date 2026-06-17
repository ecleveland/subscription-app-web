import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsMongoId,
  IsArray,
  ValidateNested,
  ArrayMinSize,
  ArrayMaxSize,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

// Which CSV column header supplies each logical field. The frontend parses the
// file into headers + rows and lets the user pick these (mapping UI lands in
// VEG-401); the backend just reads the named columns out of each row.
export class ColumnMappingDto {
  @ApiProperty({
    description: 'CSV column header holding the transaction date',
  })
  @IsString()
  @IsNotEmpty()
  date: string;

  @ApiProperty({ description: 'CSV column header holding the amount' })
  @IsString()
  @IsNotEmpty()
  amount: string;

  @ApiPropertyOptional({ description: 'CSV column header holding the payee' })
  @IsOptional()
  @IsString()
  payee?: string;

  @ApiPropertyOptional({
    description: 'CSV column header holding the category name',
  })
  @IsOptional()
  @IsString()
  category?: string;
}

// Cap the batch so a single import can't be used to exhaust memory / write a
// runaway number of documents (mirrors the bulk-input hardening guidance).
const MAX_IMPORT_ROWS = 2000;

export class ImportTransactionsDto {
  @ApiProperty({ description: 'Account to import the transactions into' })
  @IsMongoId()
  accountId: string;

  @ApiProperty({ type: ColumnMappingDto })
  @ValidateNested()
  @Type(() => ColumnMappingDto)
  mapping: ColumnMappingDto;

  @ApiProperty({
    description: 'Parsed CSV rows, each a map of column header -> cell value',
    type: 'array',
    items: { type: 'object', additionalProperties: { type: 'string' } },
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_IMPORT_ROWS)
  rows: Record<string, string>[];
}
