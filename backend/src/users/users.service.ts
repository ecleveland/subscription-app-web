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
import { SubscriptionsService } from '../subscriptions/subscriptions.service';

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    @InjectModel(RefreshToken.name)
    private refreshTokenModel: Model<RefreshTokenDocument>,
    private readonly subscriptionsService: SubscriptionsService,
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

    try {
      const saved = await user.save();
      this.logger.log(
        { userId: saved._id.toString(), username: createUserDto.username },
        'User created',
      );
      return saved;
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

  async remove(id: string): Promise<void> {
    const result = await this.userModel.findByIdAndDelete(id).exec();
    if (!result) {
      throw new NotFoundException(`User with ID "${id}" not found`);
    }
    await this.subscriptionsService.removeAllByUserId(id);
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
        await admin.save();
        this.logger.log({ username }, 'Seeded admin user');
      }
    }
  }
}
