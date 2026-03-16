import {
  Controller,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  UseGuards,
  Req,
  Logger,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { ThrottlerGuard, Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { UsersService } from '../users/users.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { AccessTokenResponseDto } from './dto/access-token-response.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { MessageResponseDto } from './dto/message-response.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { LogoutDto } from './dto/logout.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { AuthenticatedRequest } from './interfaces/jwt-payload.interface';

@ApiTags('Auth')
@Controller('auth')
@UseGuards(ThrottlerGuard)
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(
    private authService: AuthService,
    private usersService: UsersService,
  ) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @ApiOperation({ summary: 'Log in with username and password' })
  @ApiResponse({
    status: 200,
    description: 'Returns access and refresh tokens',
    type: AccessTokenResponseDto,
  })
  @ApiResponse({ status: 401, description: 'Invalid credentials' })
  async login(@Body() loginDto: LoginDto) {
    return this.authService.login(loginDto.username, loginDto.password);
  }

  @Post('register')
  @Throttle({ default: { limit: 3, ttl: 60000 } })
  @ApiOperation({ summary: 'Register a new user' })
  @ApiResponse({
    status: 201,
    description: 'User created, returns access and refresh tokens',
    type: AccessTokenResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Validation error' })
  async register(@Body() registerDto: RegisterDto) {
    await this.usersService.create({
      username: registerDto.username,
      password: registerDto.password,
      displayName: registerDto.displayName,
      email: registerDto.email,
    });
    this.logger.log({ username: registerDto.username }, 'User registered');
    return this.authService.login(registerDto.username, registerDto.password);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @ApiOperation({ summary: 'Refresh access token using a refresh token' })
  @ApiResponse({
    status: 200,
    description: 'Returns new access and refresh tokens',
    type: AccessTokenResponseDto,
  })
  @ApiResponse({ status: 401, description: 'Invalid or expired refresh token' })
  async refresh(@Body() dto: RefreshTokenDto) {
    return this.authService.refresh(dto.refresh_token);
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Logout and revoke refresh token' })
  @ApiResponse({ status: 204, description: 'Refresh token revoked' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async logout(@Req() req: AuthenticatedRequest, @Body() dto: LogoutDto) {
    await this.authService.logout(req.user.userId, dto.refresh_token);
  }

  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 3, ttl: 60000 } })
  @ApiOperation({ summary: 'Request a password reset email' })
  @ApiResponse({
    status: 200,
    description: 'Always returns success to prevent email enumeration',
    type: MessageResponseDto,
  })
  async forgotPassword(
    @Body() dto: ForgotPasswordDto,
  ): Promise<MessageResponseDto> {
    await this.authService.forgotPassword(dto.email);
    return {
      message:
        'If an account with that email exists, a password reset link has been sent.',
    };
  }

  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @ApiOperation({ summary: 'Reset password using a token from the email' })
  @ApiResponse({
    status: 200,
    description: 'Password successfully reset',
    type: MessageResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Invalid or expired token' })
  async resetPassword(
    @Body() dto: ResetPasswordDto,
  ): Promise<MessageResponseDto> {
    await this.authService.resetPassword(dto.token, dto.password);
    return { message: 'Your password has been successfully reset.' };
  }
}
