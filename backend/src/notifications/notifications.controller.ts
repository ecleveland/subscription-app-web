import {
  Controller,
  Get,
  Patch,
  Post,
  Delete,
  Param,
  Query,
  UseGuards,
  Req,
  HttpCode,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { HouseholdGuard } from '../households/guards/household.guard';
import { ParseObjectIdPipe } from '../common/pipes/parse-object-id.pipe';
import { NotificationsService } from './notifications.service';
import { QueryNotificationDto } from './dto/query-notification.dto';
import type { HouseholdRequest } from '../households/interfaces/household-request.interface';

@Controller('notifications')
@UseGuards(JwtAuthGuard, HouseholdGuard)
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  findAll(@Req() req: HouseholdRequest, @Query() query: QueryNotificationDto) {
    return this.notificationsService.findAll(req.household.householdId, query);
  }

  @Get('unread-count')
  async getUnreadCount(@Req() req: HouseholdRequest) {
    const count = await this.notificationsService.getUnreadCount(
      req.household.householdId,
    );
    return { count };
  }

  @Patch(':id/read')
  markAsRead(
    @Req() req: HouseholdRequest,
    @Param('id', ParseObjectIdPipe) id: string,
  ) {
    return this.notificationsService.markAsRead(req.household.householdId, id);
  }

  @Post('mark-all-read')
  @HttpCode(204)
  markAllAsRead(@Req() req: HouseholdRequest) {
    return this.notificationsService.markAllAsRead(req.household.householdId);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(
    @Req() req: HouseholdRequest,
    @Param('id', ParseObjectIdPipe) id: string,
  ) {
    return this.notificationsService.remove(req.household.householdId, id);
  }
}
