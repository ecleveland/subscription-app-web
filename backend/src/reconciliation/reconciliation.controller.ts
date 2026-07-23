import {
  Controller,
  Post,
  Query,
  Req,
  UseGuards,
  HttpCode,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../users/schemas/user.schema';
import type { AuthenticatedRequest } from '../auth/interfaces/jwt-payload.interface';
import { ReconciliationService } from './reconciliation.service';
import { ReconcileQueryDto } from './dto/reconcile-query.dto';

// Admin/ops-only balance reconciliation (VEG-478). Not a user-facing route: the
// same guard stack as AdminController restricts it to admins, and it acts
// cross-household (the household is an explicit query param, not resolved from
// the caller's active household).
@ApiTags('Admin')
@ApiBearerAuth()
@Controller('admin/reconciliation')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class ReconciliationController {
  private readonly logger = new Logger(ReconciliationController.name);

  constructor(private readonly reconciliationService: ReconciliationService) {}

  @Post('balances')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Reconcile cached account balances against the ledger',
    description:
      'Recomputes each account balance as openingBalanceCents + Σ(ledger) and ' +
      'corrects drift. Scope with ?householdId; use ?dryRun=true to report ' +
      'without writing. Returns a per-account audit report.',
  })
  @ApiResponse({ status: 200, description: 'Reconciliation report' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden — admin only' })
  reconcile(
    @Req() req: AuthenticatedRequest,
    @Query() query: ReconcileQueryDto,
  ) {
    this.logger.log(
      {
        adminId: req.user.userId,
        householdId: query.householdId ?? 'all',
        dryRun: query.dryRun ?? false,
      },
      'Balance reconciliation triggered',
    );
    return this.reconciliationService.reconcile({
      householdId: query.householdId,
      dryRun: query.dryRun,
    });
  }
}
