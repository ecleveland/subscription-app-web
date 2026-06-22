import {
  Controller,
  Get,
  Put,
  Delete,
  Body,
  Param,
  Req,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
} from '@nestjs/swagger';
import { BudgetsService } from './budgets.service';
import { SetBudgetCategoryDto } from './dto/set-budget-category.dto';
import { BulkSetBudgetDto } from './dto/bulk-set-budget.dto';
import type { BudgetView } from './dto/budget-view.interface';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { HouseholdGuard } from '../households/guards/household.guard';
import { ParseObjectIdPipe } from '../common/pipes/parse-object-id.pipe';
import type { HouseholdRequest } from '../households/interfaces/household-request.interface';

// Budget-vs-actual API (VEG-439): monthly category limits + actuals aggregated
// from the ledger, household-scoped. `:month` is "YYYY-MM"; the service rejects
// malformed values with 400. All money is integer cents.
@ApiTags('Budgets')
@ApiBearerAuth()
@Controller('budgets')
@UseGuards(JwtAuthGuard, HouseholdGuard)
export class BudgetsController {
  constructor(private readonly budgetsService: BudgetsService) {}

  @Get(':month')
  @ApiOperation({
    summary: "Get the household's budget-vs-actual for a month (YYYY-MM)",
    description:
      'Read-only: returns planned limits, actuals aggregated from the ledger, ' +
      'and the derived to-be-budgeted figure. An un-budgeted month returns an ' +
      'empty budget (no document is created on read).',
  })
  @ApiResponse({ status: 200, description: 'Budget-vs-actual view' })
  @ApiResponse({ status: 400, description: 'Malformed month' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  getBudget(
    @Req() req: HouseholdRequest,
    @Param('month') month: string,
  ): Promise<BudgetView> {
    return this.budgetsService.getBudgetVsActual(
      req.household.householdId,
      month,
    );
  }

  @Put(':month')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Bulk-set planned limits for several categories in a month',
    description:
      'Upserts the listed category limits (additive — not a full replace; clear ' +
      'a limit with DELETE). Returns the recomputed budget-vs-actual view.',
  })
  @ApiResponse({ status: 200, description: 'Recomputed budget-vs-actual view' })
  @ApiResponse({
    status: 400,
    description: 'Validation error / foreign category',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  bulkSet(
    @Req() req: HouseholdRequest,
    @Param('month') month: string,
    @Body() dto: BulkSetBudgetDto,
  ): Promise<BudgetView> {
    return this.budgetsService.bulkSetBudgetCategories(
      req.household.householdId,
      month,
      dto.categories,
    );
  }

  @Put(':month/categories/:categoryId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Set a category's planned limit for a month" })
  @ApiResponse({ status: 200, description: 'Limit set' })
  @ApiResponse({
    status: 400,
    description: 'Validation error / foreign category',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async setCategory(
    @Req() req: HouseholdRequest,
    @Param('month') month: string,
    @Param('categoryId', ParseObjectIdPipe) categoryId: string,
    @Body() dto: SetBudgetCategoryDto,
  ): Promise<void> {
    await this.budgetsService.setBudgetCategory(
      req.household.householdId,
      month,
      categoryId,
      dto.plannedCents,
    );
  }

  @Delete(':month/categories/:categoryId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: "Clear a category's planned limit for a month",
    description:
      'Idempotent. The category may still appear in the budget (plannedCents 0) ' +
      'if it has spend this month.',
  })
  @ApiResponse({ status: 204, description: 'Limit cleared' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async clearCategory(
    @Req() req: HouseholdRequest,
    @Param('month') month: string,
    @Param('categoryId', ParseObjectIdPipe) categoryId: string,
  ): Promise<void> {
    await this.budgetsService.deleteBudgetCategory(
      req.household.householdId,
      month,
      categoryId,
    );
  }
}
