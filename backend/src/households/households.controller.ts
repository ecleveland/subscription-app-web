import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  UseGuards,
  HttpCode,
  HttpStatus,
  Req,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
} from '@nestjs/swagger';
import { HouseholdsService } from './households.service';
import { UpdateHouseholdDto } from './dto/update-household.dto';
import { InviteMemberDto } from './dto/invite-member.dto';
import { AcceptInvitationDto } from './dto/accept-invitation.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { HouseholdGuard } from './guards/household.guard';
import type { HouseholdRequest } from './interfaces/household-request.interface';
import type { AuthenticatedRequest } from '../auth/interfaces/jwt-payload.interface';

@ApiTags('Households')
@ApiBearerAuth()
@Controller('households')
@UseGuards(JwtAuthGuard)
export class HouseholdsController {
  constructor(private readonly householdsService: HouseholdsService) {}

  @Get('me')
  @UseGuards(HouseholdGuard)
  @ApiOperation({ summary: "Get the caller's active household and members" })
  @ApiResponse({ status: 200, description: 'Household with members' })
  @ApiResponse({ status: 403, description: 'No active household membership' })
  getMyHousehold(@Req() req: HouseholdRequest) {
    return this.householdsService.getHouseholdWithMembers(
      req.household.householdId,
    );
  }

  @Patch('me')
  @UseGuards(HouseholdGuard)
  @ApiOperation({ summary: 'Update the active household (owner only)' })
  @ApiResponse({ status: 200, description: 'Household updated' })
  @ApiResponse({ status: 403, description: 'Caller is not the owner' })
  updateMyHousehold(
    @Req() req: HouseholdRequest,
    @Body() dto: UpdateHouseholdDto,
  ) {
    return this.householdsService.updateHousehold(req.household, dto);
  }

  @Get('me/members')
  @UseGuards(HouseholdGuard)
  @ApiOperation({ summary: "List the active household's members" })
  @ApiResponse({ status: 200, description: 'List of members' })
  listMembers(@Req() req: HouseholdRequest) {
    return this.householdsService.listMembers(req.household.householdId);
  }

  @Post('me/invitations')
  @UseGuards(HouseholdGuard)
  @ApiOperation({ summary: 'Invite a member by email (owner only)' })
  @ApiResponse({ status: 201, description: 'Invitation created' })
  @ApiResponse({ status: 403, description: 'Caller is not the owner' })
  @ApiResponse({ status: 409, description: 'User is already a member' })
  inviteMember(@Req() req: HouseholdRequest, @Body() dto: InviteMemberDto) {
    return this.householdsService.inviteMember(req.household, dto);
  }

  @Post('invitations/accept')
  @ApiOperation({ summary: 'Accept a household invitation via token' })
  @ApiResponse({ status: 201, description: 'Invitation accepted' })
  @ApiResponse({ status: 400, description: 'Invalid or expired invitation' })
  @ApiResponse({
    status: 403,
    description: 'Invitation was sent to a different email address',
  })
  acceptInvitation(
    @Req() req: AuthenticatedRequest,
    @Body() dto: AcceptInvitationDto,
  ) {
    return this.householdsService.acceptInvitation(req.user.userId, dto.token);
  }

  @Delete('me/members/:id')
  @UseGuards(HouseholdGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove a member (owner only; not the owner)' })
  @ApiResponse({ status: 204, description: 'Member removed' })
  @ApiResponse({ status: 403, description: 'Caller is not the owner' })
  @ApiResponse({ status: 404, description: 'Member not found' })
  removeMember(@Req() req: HouseholdRequest, @Param('id') id: string) {
    return this.householdsService.removeMember(req.household, id);
  }
}
