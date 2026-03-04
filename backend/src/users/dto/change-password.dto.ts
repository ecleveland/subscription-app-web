import { IsString, IsNotEmpty, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ChangePasswordDto {
  @ApiProperty({
    description: 'Current account password',
    example: 'OldP@ssw0rd',
  })
  @IsString()
  @IsNotEmpty()
  currentPassword: string;

  @ApiProperty({
    description: 'New password to set',
    example: 'NewP@ssw0rd123',
    minLength: 8,
  })
  @IsString()
  @MinLength(8)
  newPassword: string;
}
