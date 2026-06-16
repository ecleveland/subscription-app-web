import { Injectable, ConflictException, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Household, HouseholdDocument } from './schemas/household.schema';
import {
  HouseholdMember,
  HouseholdMemberDocument,
  HouseholdRole,
  MembershipStatus,
} from './schemas/household-member.schema';
import { CreateHouseholdDto } from './dto/create-household.dto';

export interface AddMemberParams {
  householdId: string;
  userId: string;
  role: HouseholdRole;
  status?: MembershipStatus;
}

@Injectable()
export class HouseholdsService {
  private readonly logger = new Logger(HouseholdsService.name);

  constructor(
    @InjectModel(Household.name)
    private householdModel: Model<HouseholdDocument>,
    @InjectModel(HouseholdMember.name)
    private memberModel: Model<HouseholdMemberDocument>,
  ) {}

  /**
   * Create a household owned by `ownerId` and add that user as the active
   * `owner` member. This is the canonical entry point used by registration and
   * the data migration.
   */
  async createHousehold(
    ownerId: string,
    dto: CreateHouseholdDto,
  ): Promise<HouseholdDocument> {
    const household = new this.householdModel({
      name: dto.name,
      ownerId: new Types.ObjectId(ownerId),
      currency: dto.currency ?? 'USD',
    });
    const saved = await household.save();

    await this.addMember({
      householdId: saved._id.toString(),
      userId: ownerId,
      role: HouseholdRole.OWNER,
      status: MembershipStatus.ACTIVE,
    });

    this.logger.log(
      { householdId: saved._id.toString(), ownerId },
      'Household created',
    );
    return saved;
  }

  /**
   * Add a member to a household. Active memberships are stamped with a
   * `joinedAt`; invited ones are not (they join on acceptance). Throws
   * ConflictException if the user is already a member of the household.
   */
  async addMember(params: AddMemberParams): Promise<HouseholdMemberDocument> {
    const status = params.status ?? MembershipStatus.ACTIVE;
    const member = new this.memberModel({
      householdId: new Types.ObjectId(params.householdId),
      userId: new Types.ObjectId(params.userId),
      role: params.role,
      status,
      joinedAt: status === MembershipStatus.ACTIVE ? new Date() : undefined,
    });

    try {
      return await member.save();
    } catch (error: unknown) {
      if (
        error instanceof Error &&
        'code' in error &&
        (error as { code: number }).code === 11000
      ) {
        throw new ConflictException(
          'User is already a member of this household',
        );
      }
      throw error;
    }
  }

  /**
   * Find a user's active household membership. Returns null if the user has no
   * active membership. Used to resolve the caller's active household.
   */
  async findMembershipByUser(
    userId: string,
  ): Promise<HouseholdMemberDocument | null> {
    return this.memberModel
      .findOne({
        userId: new Types.ObjectId(userId),
        status: MembershipStatus.ACTIVE,
      } as Record<string, unknown>)
      .exec();
  }
}
