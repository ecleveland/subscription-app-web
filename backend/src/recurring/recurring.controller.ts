import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { RecurringService } from './recurring.service';
import { CreateRecurringDto } from './dto/create-recurring.dto';
import { UpdateRecurringDto } from './dto/update-recurring.dto';
import { QueryRecurringDto } from './dto/query-recurring.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { HouseholdGuard } from '../households/guards/household.guard';
import { ParseObjectIdPipe } from '../common/pipes/parse-object-id.pipe';
import type { HouseholdRequest } from '../households/interfaces/household-request.interface';

// Recurring schedules (VEG-466): bills (type: expense) and scheduled income
// (type: income), household-scoped. The scheduler that materializes due
// schedules into ledger Transactions lands with VEG-467.
@ApiTags('Recurring')
@ApiBearerAuth()
@Controller('recurring')
@UseGuards(JwtAuthGuard, HouseholdGuard)
export class RecurringController {
  constructor(private readonly recurringService: RecurringService) {}

  @Post()
  @ApiOperation({ summary: 'Create a recurring schedule (bill or income)' })
  @ApiResponse({ status: 201, description: 'Schedule created' })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  create(@Req() req: HouseholdRequest, @Body() createDto: CreateRecurringDto) {
    return this.recurringService.create(
      req.household.householdId,
      req.household.memberId,
      createDto,
    );
  }

  @Get()
  @ApiOperation({
    summary: "List the household's recurring schedules, next-due first",
  })
  @ApiResponse({ status: 200, description: 'List of schedules' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  findAll(@Req() req: HouseholdRequest, @Query() query: QueryRecurringDto) {
    return this.recurringService.findAll(req.household.householdId, query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a recurring schedule by ID' })
  @ApiResponse({ status: 200, description: 'Schedule found' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Schedule not found' })
  findOne(
    @Req() req: HouseholdRequest,
    @Param('id', ParseObjectIdPipe) id: string,
  ) {
    return this.recurringService.findOne(req.household.householdId, id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a recurring schedule' })
  @ApiResponse({ status: 200, description: 'Schedule updated' })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Schedule not found' })
  update(
    @Req() req: HouseholdRequest,
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() updateDto: UpdateRecurringDto,
  ) {
    return this.recurringService.update(
      req.household.householdId,
      id,
      updateDto,
    );
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete a recurring schedule (materialized transactions are kept)',
  })
  @ApiResponse({ status: 204, description: 'Schedule deleted' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Schedule not found' })
  remove(
    @Req() req: HouseholdRequest,
    @Param('id', ParseObjectIdPipe) id: string,
  ) {
    return this.recurringService.remove(req.household.householdId, id);
  }
}
