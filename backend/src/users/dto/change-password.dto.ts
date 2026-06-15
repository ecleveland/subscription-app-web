import { IsString, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { StrongPassword } from '../../common/validators/strong-password.decorator';

export class ChangePasswordDto {
  @ApiProperty({
    description: 'Current account password',
    example: 'OldP@ssw0rd',
  })
  @IsString()
  @IsNotEmpty()
  currentPassword: string;

  @ApiProperty({
    description:
      'New password (min 8 chars, with upper-, lower-case and a digit)',
    example: 'NewP@ssw0rd123',
    minLength: 8,
  })
  @StrongPassword()
  newPassword: string;
}
