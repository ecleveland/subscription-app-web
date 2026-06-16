import { Injectable, ConflictException, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { User, UserDocument } from '../users/schemas/user.schema';
import {
  HouseholdMember,
  HouseholdMemberDocument,
  MembershipStatus,
} from './schemas/household-member.schema';
import {
  Subscription,
  SubscriptionDocument,
} from '../subscriptions/schemas/subscription.schema';
import {
  Notification,
  NotificationDocument,
} from '../notifications/schemas/notification.schema';
import { HouseholdsService } from './households.service';

@Injectable()
export class HouseholdsMigrationService {
  private readonly logger = new Logger(HouseholdsMigrationService.name);

  constructor(
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    @InjectModel(HouseholdMember.name)
    private readonly memberModel: Model<HouseholdMemberDocument>,
    @InjectModel(Subscription.name)
    private readonly subscriptionModel: Model<SubscriptionDocument>,
    @InjectModel(Notification.name)
    private readonly notificationModel: Model<NotificationDocument>,
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

  /**
   * Stamp pre-household Subscription and Notification documents with the
   * `householdId` (and `memberId` for subscriptions) of their original owner's
   * active household. Maps each active membership's legacy `userId` to its
   * household and updates only documents that don't yet carry a `householdId`.
   *
   * Run after {@link backfillPersonalHouseholds} (which guarantees every legacy
   * user has an active membership). Idempotent: once stamped, a document no
   * longer matches the `householdId: { $exists: false }` filter, so re-runs are
   * no-ops. Returns the counts stamped.
   */
  async stampExistingData(): Promise<{
    subscriptions: number;
    notifications: number;
  }> {
    const members = await this.memberModel
      .find({ status: MembershipStatus.ACTIVE } as Record<string, unknown>)
      .select('_id householdId userId')
      .lean()
      .exec();

    let subscriptions = 0;
    let notifications = 0;

    for (const member of members) {
      // The legacy `userId` field is no longer in the schemas but still lives
      // on un-migrated documents; filter against the raw value.
      const ownerFilter = {
        userId: member.userId,
        householdId: { $exists: false },
      } as Record<string, unknown>;

      const subResult = await this.subscriptionModel
        .updateMany(ownerFilter, {
          $set: {
            householdId: member.householdId,
            memberId: member._id,
          },
        })
        .exec();
      subscriptions += subResult.modifiedCount ?? 0;

      const notifResult = await this.notificationModel
        .updateMany(ownerFilter, {
          $set: { householdId: member.householdId },
        })
        .exec();
      notifications += notifResult.modifiedCount ?? 0;
    }

    if (subscriptions > 0 || notifications > 0) {
      this.logger.log(
        { subscriptions, notifications },
        'Stamped existing data with householdId',
      );
    }
    return { subscriptions, notifications };
  }
}
