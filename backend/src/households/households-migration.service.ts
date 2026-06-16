import { Injectable, ConflictException, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { User, UserDocument } from '../users/schemas/user.schema';
import {
  HouseholdMember,
  HouseholdMemberDocument,
  MembershipStatus,
} from './schemas/household-member.schema';
import { HouseholdsService } from './households.service';

@Injectable()
export class HouseholdsMigrationService {
  private readonly logger = new Logger(HouseholdsMigrationService.name);

  constructor(
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    @InjectModel(HouseholdMember.name)
    private readonly memberModel: Model<HouseholdMemberDocument>,
    private readonly householdsService: HouseholdsService,
  ) {}

  /**
   * Give every existing user a personal household with themselves as the active
   * owner. Idempotent: users who already have an active membership are skipped,
   * so re-running creates nothing new. Safe under concurrent replicas — the
   * loser of a race hits the member unique index and surfaces a
   * ConflictException, which is swallowed here. Returns the number of
   * households created.
   */
  async backfillPersonalHouseholds(): Promise<number> {
    const activeUserIds = new Set(
      (
        (await this.memberModel.distinct('userId', {
          status: MembershipStatus.ACTIVE,
        } as Record<string, unknown>)) as unknown as Types.ObjectId[]
      ).map((id) => id.toString()),
    );

    const users = await this.userModel
      .find()
      .select('_id displayName username')
      .exec();

    let created = 0;
    for (const user of users) {
      const userId = user._id.toString();
      if (activeUserIds.has(userId)) {
        continue;
      }

      const label = user.displayName?.trim() || user.username;
      try {
        await this.householdsService.createHousehold(userId, {
          name: `${label}'s Household`,
        });
        created += 1;
      } catch (error) {
        // A conflict here can only come from the partial { userId, status:active }
        // unique index — the household is freshly created, so {householdId,userId}
        // can't collide. That means the user already gained an active membership
        // (a concurrent replica or registration won the race), so they already
        // have a household. Benign: log for parity with seedAdmin and continue.
        if (error instanceof ConflictException) {
          this.logger.warn(
            { userId },
            'Skipped backfill: user already has an active membership',
          );
          continue;
        }
        this.logger.error({ userId }, 'Personal household backfill failed');
        throw error;
      }
    }

    if (created > 0) {
      this.logger.log(`Backfilled ${created} personal household(s)`);
    }
    return created;
  }
}
