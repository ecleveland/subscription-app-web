import { IsString, IsNotEmpty, IsOptional, IsEmail } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { StrongPassword } from '../../common/validators/strong-password.decorator';

export class RegisterDto {
  @ApiProperty({ description: 'Desired username', example: 'johndoe' })
  @IsString()
  @IsNotEmpty()
  username: string;

  @ApiProperty({
    description:
      'Account password (min 8 chars, with upper-, lower-case and a digit)',
    example: 'P@ssw0rd123',
    minLength: 8,
  })
  @StrongPassword()
  password: string;

  @ApiPropertyOptional({
    description: 'Display name shown in the UI',
    example: 'John Doe',
  })
  @IsOptional()
  @IsString()
  displayName?: string;

  @ApiPropertyOptional({
    description: 'Email address',
    example: 'john@example.com',
  })
  @IsOptional()
  @IsEmail()
  email?: string;
}
