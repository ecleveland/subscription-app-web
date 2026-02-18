import {
  Controller,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import { ThrottlerGuard, Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { UsersService } from '../users/users.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';

@Controller('auth')
@UseGuards(ThrottlerGuard)
export class AuthController {
  constructor(
    private authService: AuthService,
    private usersService: UsersService,
  ) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  async login(@Body() loginDto: LoginDto) {
    return this.authService.login(loginDto.username, loginDto.password);
  }

  @Post('register')
  @Throttle({ default: { limit: 3, ttl: 60000 } })
  async register(@Body() registerDto: RegisterDto) {
    await this.usersService.create({
      username: registerDto.username,
      password: registerDto.password,
      displayName: registerDto.displayName,
      email: registerDto.email,
    });
    return this.authService.login(registerDto.username, registerDto.password);
  }
}
