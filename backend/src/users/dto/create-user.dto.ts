import {
  IsString,
  IsNotEmpty,
  IsEmail,
  IsOptional,
  IsEnum,
  IsUrl,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { UserRole } from '../schemas/user.schema';
import { StrongPassword } from '../../common/validators/strong-password.decorator';

export class CreateUserDto {
  @ApiProperty({ description: 'Unique username', example: 'johndoe' })
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

  @ApiPropertyOptional({
    description: 'URL of the user avatar image',
    example: 'https://example.com/avatar.png',
  })
  @IsOptional()
  @IsUrl()
  avatarUrl?: string;

  @ApiPropertyOptional({
    enum: UserRole,
    description: 'User role for access control',
    example: UserRole.USER,
  })
  @IsOptional()
  @IsEnum(UserRole)
  role?: UserRole;
}
