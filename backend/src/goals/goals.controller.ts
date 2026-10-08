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
import { GoalsService } from './goals.service';
import { CreateGoalDto } from './dto/create-goal.dto';
import { UpdateGoalDto } from './dto/update-goal.dto';
import { QueryGoalDto } from './dto/query-goal.dto';
import { ContributeGoalDto } from './dto/contribute-goal.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { HouseholdGuard } from '../households/guards/household.guard';
import { ParseObjectIdPipe } from '../common/pipes/parse-object-id.pipe';
import type { HouseholdRequest } from '../households/interfaces/household-request.interface';

@ApiTags('Goals')
@ApiBearerAuth()
@Controller('goals')
@UseGuards(JwtAuthGuard, HouseholdGuard)
export class GoalsController {
  constructor(private readonly goalsService: GoalsService) {}

  @Post()
  @ApiOperation({ summary: 'Create a savings or debt goal' })
  @ApiResponse({ status: 201, description: 'Goal created' })
  @ApiResponse({
    status: 400,
    description: 'Validation error or foreign category',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  create(@Req() req: HouseholdRequest, @Body() dto: CreateGoalDto) {
    return this.goalsService.create(req.household.householdId, dto);
  }

  @Get()
  @ApiOperation({ summary: "List the household's goals" })
  @ApiResponse({ status: 200, description: 'List of goals' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  findAll(@Req() req: HouseholdRequest, @Query() query: QueryGoalDto) {
    return this.goalsService.findAll(
      req.household.householdId,
      query.includeArchived ?? false,
    );
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a goal by ID' })
  @ApiResponse({ status: 200, description: 'Goal found' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Goal not found' })
  findOne(
    @Req() req: HouseholdRequest,
    @Param('id', ParseObjectIdPipe) id: string,
  ) {
    return this.goalsService.findOne(req.household.householdId, id);
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Update a goal',
    description:
      'currentCents cannot be set here. Use the contributions endpoint. ' +
      'Send null for targetDate or categoryId to clear it.',
  })
  @ApiResponse({ status: 200, description: 'Goal updated' })
  @ApiResponse({
    status: 400,
    description: 'Validation error or foreign category',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Goal not found' })
  update(
    @Req() req: HouseholdRequest,
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: UpdateGoalDto,
  ) {
    return this.goalsService.update(req.household.householdId, id, dto);
  }

  @Post(':id/contributions')
  @ApiOperation({
    summary: 'Add a contribution to a goal',
    description:
      'Atomically adds amountCents to currentCents and returns the updated ' +
      'goal. A negative amount corrects an earlier contribution.',
  })
  @ApiResponse({ status: 201, description: 'Contribution applied' })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Goal not found' })
  contribute(
    @Req() req: HouseholdRequest,
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: ContributeGoalDto,
  ) {
    return this.goalsService.addContribution(
      req.household.householdId,
      id,
      dto.amountCents,
    );
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a goal' })
  @ApiResponse({ status: 204, description: 'Goal deleted' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Goal not found' })
  async remove(
    @Req() req: HouseholdRequest,
    @Param('id', ParseObjectIdPipe) id: string,
  ) {
    await this.goalsService.remove(req.household.householdId, id);
  }
}
