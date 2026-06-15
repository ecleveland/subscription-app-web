import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
  Inject,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { JwtService } from '@nestjs/jwt';
import { Model, Types } from 'mongoose';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';
import { UsersService } from '../users/users.service';
import { UserDocument } from '../users/schemas/user.schema';
import {
  PasswordReset,
  PasswordResetDocument,
} from './schemas/password-reset.schema';
import {
  RefreshToken,
  RefreshTokenDocument,
} from './schemas/refresh-token.schema';
import { MAIL_SERVICE } from '../mail/mail.service';
import type { MailService } from '../mail/mail.service';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private usersService: UsersService,
    private jwtService: JwtService,
    private configService: ConfigService,
    @InjectModel(PasswordReset.name)
    private passwordResetModel: Model<PasswordResetDocument>,
    @InjectModel(RefreshToken.name)
    private refreshTokenModel: Model<RefreshTokenDocument>,
    @Inject(MAIL_SERVICE) private mailService: MailService,
  ) {}

  // HMAC (keyed hash) so a leaked DB dump of token hashes can't be brute-forced
  // without the server-side pepper — unlike a bare SHA-256 of the token.
  private hashToken(plain: string): string {
    const pepper = this.configService.get<string>('auth.tokenPepper') ?? '';
    return crypto.createHmac('sha256', pepper).update(plain).digest('hex');
  }

  private async generateTokenPair(
    userId: string,
    username: string,
    role: string,
    tokenVersion: number,
  ): Promise<{ access_token: string; refresh_token: string }> {
    const payload = { sub: userId, username, role, tokenVersion };
    const access_token = this.jwtService.sign(payload);

    const plainToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = this.hashToken(plainToken);

    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    await new this.refreshTokenModel({
      userId: new Types.ObjectId(userId),
      tokenHash,
      expiresAt,
    }).save();

    return { access_token, refresh_token: plainToken };
  }

  async login(
    username: string,
    password: string,
  ): Promise<{ access_token: string; refresh_token: string }> {
    const user = await this.usersService.findByUsername(username);
    if (!user) {
      this.logger.warn({ username }, 'Login failed: user not found');
      throw new UnauthorizedException('Invalid credentials');
    }

    const isValid = await bcrypt.compare(password, user.passwordHash);
    if (!isValid) {
      this.logger.warn(
        { username, userId: user._id.toString() },
        'Login failed: invalid password',
      );
      throw new UnauthorizedException('Invalid credentials');
    }

    this.logger.log(
      { username, userId: user._id.toString() },
      'Login successful',
    );

    return this.generateTokenPair(
      user._id.toString(),
      user.username,
      user.role,
      user.tokenVersion,
    );
  }

  async refresh(
    refreshToken: string,
  ): Promise<{ access_token: string; refresh_token: string }> {
    const tokenHash = this.hashToken(refreshToken);

    const tokenDoc = await this.refreshTokenModel
      .findOne({
        tokenHash,
        expiresAt: { $gt: new Date() },
        revokedAt: { $exists: false },
      } as Record<string, unknown>)
      .exec();

    if (!tokenDoc) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    // Verify user still exists
    let user: UserDocument;
    try {
      user = await this.usersService.findOne(tokenDoc.userId.toString());
    } catch {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    // Revoke old token
    tokenDoc.revokedAt = new Date();
    await tokenDoc.save();

    return this.generateTokenPair(
      user._id.toString(),
      user.username,
      user.role,
      user.tokenVersion,
    );
  }

  async logout(userId: string, refreshToken: string): Promise<void> {
    const tokenHash = this.hashToken(refreshToken);

    await this.refreshTokenModel
      .findOneAndUpdate(
        {
          userId: new Types.ObjectId(userId),
          tokenHash,
          revokedAt: { $exists: false },
        } as Record<string, unknown>,
        { revokedAt: new Date() },
      )
      .exec();

    // Invalidate any outstanding access tokens for this user.
    await this.usersService.incrementTokenVersion(userId);
  }

  async revokeAllRefreshTokens(userId: string): Promise<void> {
    await this.refreshTokenModel
      .updateMany(
        {
          userId: new Types.ObjectId(userId),
          revokedAt: { $exists: false },
        } as Record<string, unknown>,
        { revokedAt: new Date() },
      )
      .exec();
  }

  async forgotPassword(email: string): Promise<void> {
    const user = await this.usersService.findByEmail(email);

    // Generate the token + hash unconditionally so the response time doesn't
    // differ measurably between known and unknown emails (timing oracle).
    const plainToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = this.hashToken(plainToken);
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    if (!user || !user.email) {
      this.logger.log('Password reset requested for unknown email');
      return;
    }

    this.logger.log(
      { userId: user._id.toString() },
      'Password reset requested',
    );

    // Invalidate any prior unused reset tokens so only the newest one is valid.
    await this.passwordResetModel
      .updateMany(
        { email: user.email, usedAt: { $exists: false } } as Record<
          string,
          unknown
        >,
        { usedAt: new Date() },
      )
      .exec();

    await new this.passwordResetModel({
      email: user.email,
      tokenHash,
      expiresAt,
    }).save();

    const frontendUrl =
      this.configService.get<string>('frontendUrl') || 'http://localhost:3000';
    const resetUrl = `${frontendUrl}/reset-password?token=${plainToken}`;

    // Fire-and-forget so the SMTP round-trip neither blocks the response nor
    // leaks (via timing) whether the email exists.
    void this.mailService
      .sendPasswordResetEmail(user.email, resetUrl)
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.error(`Failed to send password reset email: ${message}`);
      });
  }

  async resetPassword(token: string, newPassword: string): Promise<void> {
    const tokenHash = this.hashToken(token);

    const resetDoc = await this.passwordResetModel
      .findOne({
        tokenHash,
        expiresAt: { $gt: new Date() },
        usedAt: { $exists: false },
      } as Record<string, unknown>)
      .exec();

    if (!resetDoc) {
      this.logger.warn('Password reset attempted with invalid/expired token');
      throw new BadRequestException('Invalid or expired password reset token');
    }

    const user = await this.usersService.findByEmail(resetDoc.email);
    if (!user) {
      throw new BadRequestException('Invalid or expired password reset token');
    }

    user.passwordHash = await bcrypt.hash(newPassword, 10);
    await user.save();

    resetDoc.usedAt = new Date();
    await resetDoc.save();

    await this.revokeAllRefreshTokens(user._id.toString());
    // Invalidate any outstanding access tokens issued before the reset.
    await this.usersService.incrementTokenVersion(user._id.toString());

    this.logger.log(
      { userId: user._id.toString() },
      'Password reset completed',
    );
  }
}
