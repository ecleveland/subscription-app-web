import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
} from '@nestjs/swagger';
import { ReportsService } from './reports.service';
import { CashFlowQueryDto } from './dto/cash-flow-query.dto';
import type { CashFlowReport } from './interfaces/cash-flow.interface';
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
      'at 36 months.',
  })
  @ApiResponse({ status: 200, description: 'Cash flow by month' })
  @ApiResponse({
    status: 400,
    description: 'Malformed month, from after to, or range over 36 months',
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
}
