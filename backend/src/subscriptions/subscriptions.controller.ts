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
} from '@nestjs/common';
import { SubscriptionsService } from './subscriptions.service';
import { CreateSubscriptionDto } from './dto/create-subscription.dto';
import { UpdateSubscriptionDto } from './dto/update-subscription.dto';
import { QuerySubscriptionDto } from './dto/query-subscription.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { AuthenticatedRequest } from '../auth/interfaces/jwt-payload.interface';

@Controller('subscriptions')
@UseGuards(JwtAuthGuard)
export class SubscriptionsController {
  constructor(private readonly subscriptionsService: SubscriptionsService) {}

  @Post()
  create(
    @Req() req: AuthenticatedRequest,
    @Body() createDto: CreateSubscriptionDto,
  ) {
    return this.subscriptionsService.create(req.user.userId, createDto);
  }

  @Get()
  findAll(
    @Req() req: AuthenticatedRequest,
    @Query() query: QuerySubscriptionDto,
  ) {
    return this.subscriptionsService.findAll(req.user.userId, query);
  }

  @Get(':id')
  findOne(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.subscriptionsService.findOne(req.user.userId, id);
  }

  @Patch(':id')
  update(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() updateDto: UpdateSubscriptionDto,
  ) {
    return this.subscriptionsService.update(req.user.userId, id, updateDto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.subscriptionsService.remove(req.user.userId, id);
  }
}
