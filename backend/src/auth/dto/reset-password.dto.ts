import { IsString, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { StrongPassword } from '../../common/validators/strong-password.decorator';

export class ResetPasswordDto {
  @ApiProperty({
    description: 'Password reset token from the email link',
    example: 'a1b2c3d4e5f6...',
  })
  @IsString()
  @IsNotEmpty()
  token: string;

  @ApiProperty({
    description:
      'New password (min 8 chars, with upper-, lower-case and a digit)',
    example: 'NewP@ssw0rd1',
  })
  @StrongPassword()
  password: string;
}
