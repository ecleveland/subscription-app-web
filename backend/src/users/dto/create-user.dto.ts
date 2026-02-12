import {
  IsString,
  IsNotEmpty,
  IsEmail,
  IsOptional,
  IsEnum,
  MinLength,
  IsUrl,
} from 'class-validator';
import { UserRole } from '../schemas/user.schema';

export class CreateUserDto {
  @IsString()
  @IsNotEmpty()
  username: string;

  @IsString()
  @MinLength(8)
  password: string;

  @IsOptional()
  @IsString()
  displayName?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsUrl()
  avatarUrl?: string;

  @IsOptional()
  @IsEnum(UserRole)
  role?: UserRole;
}
