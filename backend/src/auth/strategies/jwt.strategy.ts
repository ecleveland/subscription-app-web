import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { UsersService } from '../../users/users.service';
import { JwtPayload, JwtUser } from '../interfaces/jwt-payload.interface';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    configService: ConfigService,
    private readonly usersService: UsersService,
  ) {
    const secret = configService.get<string>('auth.jwtSecret');
    if (!secret) {
      throw new Error('JWT_SECRET environment variable is not set');
    }
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: secret,
    });
  }

  // Runs on every authenticated request. Unlike a claims-only check, this hits
  // the DB so a deleted user is rejected, a demoted user's role is downgraded
  // immediately, and a stale token (issued before a tokenVersion bump from
  // logout/password-change/reset) is rejected.
  async validate(payload: JwtPayload): Promise<JwtUser> {
    const user = await this.usersService.findOne(payload.sub).catch(() => null);
    if (!user) {
      throw new UnauthorizedException('User no longer exists');
    }

    if (payload.tokenVersion !== user.tokenVersion) {
      throw new UnauthorizedException('Token has been revoked');
    }

    return {
      userId: user._id.toString(),
      username: user.username,
      role: user.role,
    };
  }
}
