import { Controller } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

// Phase 3 scaffold (VEG-438): an intentionally routeless placeholder so the
// module mirrors the accounts/transactions controller→service→schema structure.
// The endpoints — GET /budgets/:month (budget-vs-actual), PUT/DELETE
// /budgets/:month/categories/:categoryId — plus the JwtAuthGuard + HouseholdGuard
// they sit behind land in VEG-439.
@ApiTags('Budgets')
@Controller('budgets')
export class BudgetsController {}
