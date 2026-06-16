import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
  Req,
  Res,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
} from '@nestjs/swagger';
import { SubscriptionsService } from './subscriptions.service';
import { CreateSubscriptionDto } from './dto/create-subscription.dto';
import { UpdateSubscriptionDto } from './dto/update-subscription.dto';
import { QuerySubscriptionDto } from './dto/query-subscription.dto';
import { BulkOperationDto } from './dto/bulk-operation.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { HouseholdGuard } from '../households/guards/household.guard';
import type { HouseholdRequest } from '../households/interfaces/household-request.interface';
import type { Response } from 'express';

@ApiTags('Subscriptions')
@ApiBearerAuth()
@Controller('subscriptions')
@UseGuards(JwtAuthGuard, HouseholdGuard)
export class SubscriptionsController {
  constructor(private readonly subscriptionsService: SubscriptionsService) {}

  @Post()
  @ApiOperation({ summary: 'Create a subscription' })
  @ApiResponse({ status: 201, description: 'Subscription created' })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  create(
    @Req() req: HouseholdRequest,
    @Body() createDto: CreateSubscriptionDto,
  ) {
    return this.subscriptionsService.create(
      req.household.householdId,
      req.household.memberId,
      createDto,
    );
  }

  @Get()
  @ApiOperation({ summary: 'List subscriptions for the current user' })
  @ApiResponse({ status: 200, description: 'Paginated list of subscriptions' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  findAll(@Req() req: HouseholdRequest, @Query() query: QuerySubscriptionDto) {
    return this.subscriptionsService.findAll(req.household.householdId, query);
  }

  @Get('export')
  @ApiOperation({ summary: 'Export subscriptions as CSV' })
  @ApiResponse({ status: 200, description: 'CSV file download' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async exportCsv(
    @Req() req: HouseholdRequest,
    @Query() query: QuerySubscriptionDto,
    @Res() res: Response,
  ) {
    const csv = await this.subscriptionsService.exportCsv(
      req.household.householdId,
      query,
    );
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="subscriptions.csv"',
    );
    res.send(csv);
  }

  @Post('bulk')
  @ApiOperation({ summary: 'Perform bulk operations on subscriptions' })
  @ApiResponse({ status: 200, description: 'Bulk operation result' })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  bulk(@Req() req: HouseholdRequest, @Body() bulkDto: BulkOperationDto) {
    return this.subscriptionsService.bulkOperation(
      req.household.householdId,
      bulkDto,
    );
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a subscription by ID' })
  @ApiResponse({ status: 200, description: 'Subscription found' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Subscription not found' })
  findOne(@Req() req: HouseholdRequest, @Param('id') id: string) {
    return this.subscriptionsService.findOne(req.household.householdId, id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a subscription' })
  @ApiResponse({ status: 200, description: 'Subscription updated' })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Subscription not found' })
  update(
    @Req() req: HouseholdRequest,
    @Param('id') id: string,
    @Body() updateDto: UpdateSubscriptionDto,
  ) {
    return this.subscriptionsService.update(
      req.household.householdId,
      id,
      updateDto,
    );
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a subscription' })
  @ApiResponse({ status: 204, description: 'Subscription deleted' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Subscription not found' })
  remove(@Req() req: HouseholdRequest, @Param('id') id: string) {
    return this.subscriptionsService.remove(req.household.householdId, id);
  }
}
