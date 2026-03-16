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
import { Model } from 'mongoose';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';
import { UsersService } from '../users/users.service';
import {
  PasswordReset,
  PasswordResetDocument,
} from './schemas/password-reset.schema';
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
    @Inject(MAIL_SERVICE) private mailService: MailService,
  ) {}

  async login(
    username: string,
    password: string,
  ): Promise<{ access_token: string }> {
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

    const payload = {
      sub: user._id.toString(),
      username: user.username,
      role: user.role,
    };
    return {
      access_token: this.jwtService.sign(payload),
    };
  }

  async forgotPassword(email: string): Promise<void> {
    const user = await this.usersService.findByEmail(email);
    if (!user) {
      this.logger.log('Password reset requested for unknown email');
      return;
    }

    this.logger.log(
      { userId: user._id.toString() },
      'Password reset requested',
    );

    const plainToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto
      .createHash('sha256')
      .update(plainToken)
      .digest('hex');

    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    await new this.passwordResetModel({
      email: user.email,
      tokenHash,
      expiresAt,
    }).save();

    const frontendUrl =
      this.configService.get<string>('frontendUrl') || 'http://localhost:3000';
    const resetUrl = `${frontendUrl}/reset-password?token=${plainToken}`;

    await this.mailService.sendPasswordResetEmail(user.email!, resetUrl);
  }

  async resetPassword(token: string, newPassword: string): Promise<void> {
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

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

    this.logger.log(
      { userId: user._id.toString() },
      'Password reset completed',
    );
  }
}
