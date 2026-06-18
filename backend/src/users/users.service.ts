import {
  Injectable,
  ConflictException,
  ForbiddenException,
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
    let user: UserDocument | null;
    try {
      user = await this.userModel
        .findByIdAndUpdate(id, updateDto, { new: true, runValidators: true })
        .select('-passwordHash')
        .exec();
    } catch (error: unknown) {
      // A username/email change colliding with another user surfaces as a
      // duplicate-key error; report it as a 409 like create() does, not a 500.
      if (
        error instanceof Error &&
        'code' in error &&
        (error as { code: number }).code === 11000
      ) {
        throw new ConflictException('Username or email already exists');
      }
      throw error;
    }
    if (!user) {
      throw new NotFoundException(`User with ID "${id}" not found`);
    }
    return user;
  }

  /**
   * Demote an admin to a regular user without ever stripping the last admin.
   * Single-node Mongo has no multi-document transactions, so instead of the
   * racy check-then-act (count admins, then demote) we demote first via an
   * atomic `findOneAndUpdate({_id, role: ADMIN})`, then count: if that left zero
   * admins we roll the demotion back and reject. Two concurrent demotes can't
   * both observe a safe count, so the "at least one admin" invariant holds.
   * No-op when the target isn't currently an admin. Returns true when it
   * actually demoted an admin (so a caller can compensate if a follow-up step,
   * e.g. a delete, then fails), false when it was a no-op.
   */
  async demoteAdminSafely(id: string): Promise<boolean> {
    const demoted = await this.userModel
      .findOneAndUpdate(
        { _id: new Types.ObjectId(id), role: UserRole.ADMIN } as Record<
          string,
          unknown
        >,
        { $set: { role: UserRole.USER } },
        { new: true },
      )
      .exec();
    if (!demoted) {
      return false;
    }
    if ((await this.countAdmins()) === 0) {
      // We just removed the last admin — restore it and reject. Log loudly: if
      // the rollback write itself fails the system is left with zero admins,
      // which must be greppable rather than silent.
      this.logger.warn({ userId: id }, 'Blocked demotion of the last admin');
      try {
        await this.userModel
          .findByIdAndUpdate(id, { $set: { role: UserRole.ADMIN } })
          .exec();
      } catch (error: unknown) {
        this.logger.error(
          { userId: id, error },
          'CRITICAL: failed to roll back last-admin demotion; system may now have zero admins',
        );
      }
      throw new ForbiddenException('Cannot remove the last admin');
    }
    return true;
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
    // Drop the deleted user's refresh tokens so a stolen/active token can't be
    // used to mint new access tokens after the account is gone.
    await this.refreshTokenModel
      .deleteMany({ userId: new Types.ObjectId(id) } as Record<string, unknown>)
      .exec();
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
