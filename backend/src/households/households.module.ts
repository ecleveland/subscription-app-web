import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { HouseholdsService } from './households.service';
import { HouseholdsMigrationService } from './households-migration.service';
import { HouseholdGuard } from './guards/household.guard';
import { Household, HouseholdSchema } from './schemas/household.schema';
import {
  HouseholdMember,
  HouseholdMemberSchema,
} from './schemas/household-member.schema';
import { Invitation, InvitationSchema } from './schemas/invitation.schema';
import { User, UserSchema } from '../users/schemas/user.schema';
import {
  Subscription,
  SubscriptionSchema,
} from '../subscriptions/schemas/subscription.schema';
import {
  Notification,
  NotificationSchema,
} from '../notifications/schemas/notification.schema';

// HTTP endpoints (household management + invitation flow) land in VEG-390. This
// module provides the data model, HouseholdsService, HouseholdGuard, and the
// startup data migration. The guard is exported so household-scoped controllers
// (VEG-389/390) can apply it after JwtAuthGuard; the migration service is
// exported so the bootstrap can run it. The User model is registered read-only
// for the migration's per-user backfill; the Subscription/Notification models
// let the migration stamp existing single-user data with its householdId.
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Household.name, schema: HouseholdSchema },
      { name: HouseholdMember.name, schema: HouseholdMemberSchema },
      { name: Invitation.name, schema: InvitationSchema },
      { name: User.name, schema: UserSchema },
      { name: Subscription.name, schema: SubscriptionSchema },
      { name: Notification.name, schema: NotificationSchema },
    ]),
  ],
  providers: [HouseholdsService, HouseholdsMigrationService, HouseholdGuard],
  exports: [HouseholdsService, HouseholdsMigrationService, HouseholdGuard],
})
export class HouseholdsModule {}
