import {
  Controller,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  UseGuards,
  Req,
  Res,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { ThrottlerGuard, Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { UsersService } from '../users/users.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { AccessTokenResponseDto } from './dto/access-token-response.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { MessageResponseDto } from './dto/message-response.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import type { AuthenticatedRequest } from './interfaces/jwt-payload.interface';
import {
  REFRESH_COOKIE,
  refreshCookieOptions,
  clearRefreshCookieOptions,
} from './cookie.config';

@ApiTags('Auth')
@Controller('auth')
@UseGuards(ThrottlerGuard)
export class AuthController {
  private readonly logger = new Logger(AuthController.name);
  private readonly isProd = process.env.NODE_ENV === 'production';

  constructor(
    private authService: AuthService,
    private usersService: UsersService,
  ) {}

  /**
   * Set the refresh token as an httpOnly cookie and return only the access
   * token in the body. Keeping the long-lived refresh token out of JS-readable
   * storage means an XSS payload can't exfiltrate it.
   */
  private issueTokens(
    res: Response,
    tokens: { access_token: string; refresh_token: string },
  ): AccessTokenResponseDto {
    res.cookie(
      REFRESH_COOKIE,
      tokens.refresh_token,
      refreshCookieOptions(this.isProd),
    );
    return { access_token: tokens.access_token };
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @ApiOperation({ summary: 'Log in with username and password' })
  @ApiResponse({
    status: 200,
    description: 'Returns an access token; sets the refresh token cookie',
    type: AccessTokenResponseDto,
  })
  @ApiResponse({ status: 401, description: 'Invalid credentials' })
  async login(
    @Body() loginDto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AccessTokenResponseDto> {
    const tokens = await this.authService.login(
      loginDto.username,
      loginDto.password,
    );
    return this.issueTokens(res, tokens);
  }

  @Post('register')
  @Throttle({ default: { limit: 3, ttl: 60000 } })
  @ApiOperation({ summary: 'Register a new user' })
  @ApiResponse({
    status: 201,
    description: 'User created; returns an access token + refresh cookie',
    type: AccessTokenResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Validation error' })
  async register(
    @Body() registerDto: RegisterDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AccessTokenResponseDto> {
    await this.usersService.create({
      username: registerDto.username,
      password: registerDto.password,
      displayName: registerDto.displayName,
      email: registerDto.email,
    });
    this.logger.log({ username: registerDto.username }, 'User registered');
    const tokens = await this.authService.login(
      registerDto.username,
      registerDto.password,
    );
    return this.issueTokens(res, tokens);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @ApiOperation({
    summary: 'Refresh the access token using the refresh cookie',
  })
  @ApiResponse({
    status: 200,
    description: 'Returns a new access token; rotates the refresh cookie',
    type: AccessTokenResponseDto,
  })
  @ApiResponse({ status: 401, description: 'Invalid or expired refresh token' })
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AccessTokenResponseDto> {
    const refreshToken = req.cookies?.[REFRESH_COOKIE] as string | undefined;
    if (!refreshToken) {
      throw new UnauthorizedException('No refresh token');
    }
    const tokens = await this.authService.refresh(refreshToken);
    return this.issueTokens(res, tokens);
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Logout: revoke the refresh token and clear cookie',
  })
  @ApiResponse({ status: 204, description: 'Refresh token revoked' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async logout(
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    const refreshToken = req.cookies?.[REFRESH_COOKIE] as string | undefined;
    if (refreshToken) {
      await this.authService.logout(req.user.userId, refreshToken);
    }
    res.clearCookie(REFRESH_COOKIE, clearRefreshCookieOptions(this.isProd));
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
