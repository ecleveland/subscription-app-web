import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
} from '@nestjs/swagger';
import { ReportsService } from './reports.service';
import {
  CashFlowQueryDto,
  MAX_CASH_FLOW_MONTHS,
} from './dto/cash-flow-query.dto';
import { SpendingQueryDto } from './dto/spending-query.dto';
import type { CashFlowReport } from './interfaces/cash-flow.interface';
import type { SpendingReport } from './interfaces/spending.interface';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { HouseholdGuard } from '../households/guards/household.guard';
import type { HouseholdRequest } from '../households/interfaces/household-request.interface';

// Read-only reports over the household ledger (Phase 5). Household-scoped by
// HouseholdGuard. All money is integer cents.
@ApiTags('Reports')
@ApiBearerAuth()
@Controller('reports')
@UseGuards(JwtAuthGuard, HouseholdGuard)
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Get('cash-flow')
  @ApiOperation({
    summary: 'Income, expense and net per month (YYYY-MM range, inclusive)',
    description:
      'Sums income and expense transactions by UTC month. Transfers are ' +
      'excluded. Months with no activity are zero-filled. The range is capped ' +
      `at ${MAX_CASH_FLOW_MONTHS} months.`,
  })
  @ApiResponse({ status: 200, description: 'Cash flow by month' })
  @ApiResponse({
    status: 400,
    description: `Malformed month, from after to, or range over ${MAX_CASH_FLOW_MONTHS} months`,
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  getCashFlow(
    @Req() req: HouseholdRequest,
    @Query() query: CashFlowQueryDto,
  ): Promise<CashFlowReport> {
    return this.reportsService.getCashFlow(
      req.household.householdId,
      query.from,
      query.to,
    );
  }

  @Get('spending')
  @ApiOperation({
    summary: 'Expense spend per category for one month, with planned amounts',
    description:
      'Sums expense transactions by category for a UTC month and pairs each ' +
      "with that month's planned amount, or null when none is set. Income " +
      'categories get no row. Expense spend on an unknown or income category ' +
      'is reported as uncategorizedCents, so the rows plus uncategorizedCents ' +
      'equal totalCents.',
  })
  @ApiResponse({ status: 200, description: 'Spending by category' })
  @ApiResponse({ status: 400, description: 'Missing or malformed month' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  getSpending(
    @Req() req: HouseholdRequest,
    @Query() query: SpendingQueryDto,
  ): Promise<SpendingReport> {
    return this.reportsService.getSpending(
      req.household.householdId,
      query.month,
    );
  }
}
