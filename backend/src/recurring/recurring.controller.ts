import { Controller } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

// Phase 4 scaffold (VEG-465): an intentionally routeless placeholder so the
// module mirrors the accounts/transactions/budgets controller→service→schema
// structure. The endpoints — GET/POST /recurring, GET/PATCH/DELETE
// /recurring/:id — plus the JwtAuthGuard + HouseholdGuard they sit behind land
// in VEG-466.
@ApiTags('Recurring')
@Controller('recurring')
export class RecurringController {}
