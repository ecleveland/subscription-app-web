import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { HouseholdsService } from './households.service';
import { Household, HouseholdSchema } from './schemas/household.schema';
import {
  HouseholdMember,
  HouseholdMemberSchema,
} from './schemas/household-member.schema';
import { Invitation, InvitationSchema } from './schemas/invitation.schema';

// HTTP endpoints (household management + invitation flow) and the
// HouseholdGuard land in follow-up tickets (VEG-387, VEG-390). This module
// currently provides the data model and service used by registration, the
// data migration, and the guard.
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Household.name, schema: HouseholdSchema },
      { name: HouseholdMember.name, schema: HouseholdMemberSchema },
      { name: Invitation.name, schema: InvitationSchema },
    ]),
  ],
  providers: [HouseholdsService],
  exports: [HouseholdsService],
})
export class HouseholdsModule {}
