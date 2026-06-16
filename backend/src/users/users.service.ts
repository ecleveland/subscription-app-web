import {
  Injectable,
  ConflictException,
  NotFoundException,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import * as bcrypt from 'bcryptjs';
import { User, UserDocument, UserRole } from './schemas/user.schema';
import {
  RefreshToken,
  RefreshTokenDocument,
} from '../auth/schemas/refresh-token.schema';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { AdminUpdateUserDto } from './dto/admin-update-user.dto';
import { HouseholdsService } from '../households/households.service';

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    @InjectModel(RefreshToken.name)
    private refreshTokenModel: Model<RefreshTokenDocument>,
    private readonly householdsService: HouseholdsService,
  ) {}

  async create(createUserDto: CreateUserDto): Promise<UserDocument> {
    const passwordHash = await bcrypt.hash(createUserDto.password, 10);
    const user = new this.userModel({
      username: createUserDto.username,
      passwordHash,
      displayName: createUserDto.displayName,
      email: createUserDto.email,
      avatarUrl: createUserDto.avatarUrl,
      role: createUserDto.role ?? UserRole.USER,
    });

    let saved: UserDocument;
    try {
      saved = await user.save();
    } catch (error: unknown) {
      if (
        error instanceof Error &&
        'code' in error &&
        (error as { code: number }).code === 11000
      ) {
        throw new ConflictException('Username or email already exists');
      }
      throw error;
    }
    this.logger.log(
      { userId: saved._id.toString(), username: createUserDto.username },
      'User created',
    );

    // Provision a personal household + owner membership so household-scoped
    // features (subscriptions, notifications) work immediately for the new
    // user — mirrors the startup backfill for pre-household users. If it fails,
    // roll the user back rather than leaving an account that can't resolve an
    // active household (HouseholdGuard would reject every request).
    try {
      const label = saved.displayName?.trim() || saved.username;
      await this.householdsService.createHousehold(saved._id.toString(), {
        name: `${label}'s Household`,
      });
    } catch (error: unknown) {
      // Best-effort rollback. If the delete itself fails the user is left
      // without a household (HouseholdGuard will reject them until the startup
      // backfill repairs it), so log that case rather than swallowing it.
      await this.userModel
        .findByIdAndDelete(saved._id)
        .exec()
        .catch((rollbackError: unknown) => {
          this.logger.error(
            { userId: saved._id.toString(), rollbackError },
            'User rollback delete failed; account orphaned without a household',
          );
        });
      this.logger.error(
        { userId: saved._id.toString() },
        'Failed to create personal household; rolled back user',
      );
      throw error;
    }

    return saved;
  }

  async findAll(): Promise<UserDocument[]> {
    return this.userModel.find().select('-passwordHash').exec();
  }

  async findOne(id: string): Promise<UserDocument> {
    const user = await this.userModel.findById(id).exec();
    if (!user) {
      throw new NotFoundException(`User with ID "${id}" not found`);
    }
    return user;
  }

  async findOnePublic(id: string): Promise<UserDocument> {
    const user = await this.userModel
      .findById(id)
      .select('-passwordHash')
      .exec();
    if (!user) {
      throw new NotFoundException(`User with ID "${id}" not found`);
    }
    return user;
  }

  async findByUsername(username: string): Promise<UserDocument | null> {
    return this.userModel.findOne({ username: username.toLowerCase() }).exec();
  }

  async findByEmail(email: string): Promise<UserDocument | null> {
    return this.userModel
      .findOne({ email: email.toLowerCase() } as Record<string, unknown>)
      .exec();
  }

  async update(
    id: string,
    updateDto: UpdateUserDto | AdminUpdateUserDto,
  ): Promise<UserDocument> {
    const user = await this.userModel
      .findByIdAndUpdate(id, updateDto, { new: true, runValidators: true })
      .select('-passwordHash')
      .exec();
    if (!user) {
      throw new NotFoundException(`User with ID "${id}" not found`);
    }
    return user;
  }

  async changePassword(
    id: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<void> {
    const user = await this.findOne(id);
    const isValid = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!isValid) {
      throw new UnauthorizedException('Current password is incorrect');
    }
    user.passwordHash = await bcrypt.hash(newPassword, 10);
    // Bump tokenVersion so existing access tokens are rejected immediately.
    user.tokenVersion += 1;
    await user.save();

    await this.refreshTokenModel
      .updateMany(
        {
          userId: new Types.ObjectId(id),
          revokedAt: { $exists: false },
        } as Record<string, unknown>,
        { revokedAt: new Date() },
      )
      .exec();

    this.logger.log({ userId: id }, 'Password changed');
  }

  async incrementTokenVersion(id: string): Promise<void> {
    await this.userModel
      .updateOne({ _id: new Types.ObjectId(id) } as Record<string, unknown>, {
        $inc: { tokenVersion: 1 },
      })
      .exec();
  }

  async remove(id: string): Promise<void> {
    // Verify the user exists before touching dependents, then remove the
    // memberships *before* the user row so a mid-cascade failure can't leave an
    // orphaned active membership pointing at a deleted user (which would also
    // occupy the partial-unique active-membership slot). Subscriptions and
    // notifications belong to the household (shared data) and intentionally
    // survive a single member's deletion — a dedicated household-teardown path
    // is responsible for cascading that data.
    const user = await this.userModel.findById(id).exec();
    if (!user) {
      throw new NotFoundException(`User with ID "${id}" not found`);
    }
    await this.householdsService.removeMembershipsByUser(id);
    await this.userModel.findByIdAndDelete(id).exec();
    this.logger.log({ userId: id }, 'User deleted');
  }

  async countAdmins(): Promise<number> {
    return this.userModel.countDocuments({ role: UserRole.ADMIN }).exec();
  }

  async seedAdmin(username: string, passwordHash: string): Promise<void> {
    const adminCount = await this.countAdmins();
    if (adminCount === 0 && passwordHash) {
      const existing = await this.findByUsername(username);
      if (!existing) {
        const admin = new this.userModel({
          username: username.toLowerCase(),
          passwordHash,
          displayName: 'Admin',
          role: UserRole.ADMIN,
        });
        try {
          await admin.save();
          this.logger.log({ username }, 'Seeded admin user');
        } catch (error: unknown) {
          // Concurrent boots (multiple replicas/restarts) can race to insert
          // the same admin. The loser's duplicate-key error is benign — the
          // admin now exists — so swallow it rather than crash startup.
          if (
            error instanceof Error &&
            'code' in error &&
            (error as { code: number }).code === 11000
          ) {
            this.logger.warn(
              { username },
              'Admin already seeded by another instance; skipping',
            );
            return;
          }
          throw error;
        }
      }
    }
  }
}
