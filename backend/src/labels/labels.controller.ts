import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
} from '@nestjs/swagger';
import { LabelsService } from './labels.service';
import { CreateLabelDto } from './dto/create-label.dto';
import { UpdateLabelDto } from './dto/update-label.dto';
import { RemoveLabelOutcomeDto } from './dto/remove-label-outcome.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { HouseholdGuard } from '../households/guards/household.guard';
import { ParseObjectIdPipe } from '../common/pipes/parse-object-id.pipe';
import type { HouseholdRequest } from '../households/interfaces/household-request.interface';

// Household business labels (VEG-697). Every route is household-scoped by
// HouseholdGuard; ids in paths and bodies are re-validated against the
// caller's household, never trusted. Any active household member may write,
// the same policy as categories.
@ApiTags('Labels')
@ApiBearerAuth()
@Controller('labels')
@UseGuards(JwtAuthGuard, HouseholdGuard)
export class LabelsController {
  constructor(private readonly labelsService: LabelsService) {}

  @Get()
  @ApiOperation({ summary: "List the household's labels" })
  @ApiResponse({ status: 200, description: 'List of labels' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  findAll(
    @Req() req: HouseholdRequest,
    @Query('includeArchived') includeArchived?: string,
  ) {
    return this.labelsService.list(
      req.household.householdId,
      includeArchived === 'true',
    );
  }

  @Post()
  @ApiOperation({ summary: 'Create a label' })
  @ApiResponse({ status: 201, description: 'Created label' })
  @ApiResponse({
    status: 400,
    description: 'Validation error / foreign or archived parent',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 409, description: 'Duplicate name in the household' })
  create(@Req() req: HouseholdRequest, @Body() dto: CreateLabelDto) {
    return this.labelsService.create(req.household.householdId, dto);
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Update a label (rename, recolor, re-parent, archive)',
  })
  @ApiResponse({ status: 200, description: 'Updated label' })
  @ApiResponse({
    status: 400,
    description: 'Validation error / unusable parent / parent loop',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Label not found' })
  @ApiResponse({ status: 409, description: 'Duplicate name in the household' })
  update(
    @Req() req: HouseholdRequest,
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: UpdateLabelDto,
  ) {
    return this.labelsService.update(req.household.householdId, id, dto);
  }

  @Delete(':id')
  @ApiOperation({
    summary: 'Delete a label (archives instead when referenced)',
    description:
      'Hard-deletes only when no transaction, recurring template or goal ' +
      'references the label; otherwise archives it. The outcome reports ' +
      'which happened. Blocked (409) while another label has it as parent.',
  })
  @ApiResponse({
    status: 200,
    description: 'Which fate the label met',
    type: RemoveLabelOutcomeDto,
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Label not found' })
  @ApiResponse({ status: 409, description: 'Label has child labels' })
  remove(
    @Req() req: HouseholdRequest,
    @Param('id', ParseObjectIdPipe) id: string,
  ) {
    return this.labelsService.remove(req.household.householdId, id);
  }
}
