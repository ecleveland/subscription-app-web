import { Controller, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

// Phase 4 scaffold (VEG-465): an intentionally routeless placeholder so the
// module mirrors the accounts/transactions/budgets controller→service→schema
// structure. The endpoints — GET/POST /recurring, GET/PATCH/DELETE
// /recurring/:id — land in VEG-466 along with HouseholdGuard. JwtAuthGuard is
// applied to the empty class already (the controller is live in AppModule) so
// any route added here is secure-by-default, matching every sibling controller.
@ApiTags('Recurring')
@UseGuards(JwtAuthGuard)
@Controller('recurring')
export class RecurringController {}
