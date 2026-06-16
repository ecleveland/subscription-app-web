import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { HouseholdsService } from './households.service';
import { HouseholdGuard } from './guards/household.guard';
import { Household, HouseholdSchema } from './schemas/household.schema';
import {
  HouseholdMember,
  HouseholdMemberSchema,
} from './schemas/household-member.schema';
import { Invitation, InvitationSchema } from './schemas/invitation.schema';

// HTTP endpoints (household management + invitation flow) land in VEG-390. This
// module provides the data model, HouseholdsService, and HouseholdGuard; the
// guard is exported so household-scoped controllers (VEG-389/390) can apply it
// after JwtAuthGuard. Data-migration and registration wiring arrive in their
// own tickets.
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Household.name, schema: HouseholdSchema },
      { name: HouseholdMember.name, schema: HouseholdMemberSchema },
      { name: Invitation.name, schema: InvitationSchema },
    ]),
  ],
  providers: [HouseholdsService, HouseholdGuard],
  exports: [HouseholdsService, HouseholdGuard],
})
export class HouseholdsModule {}
