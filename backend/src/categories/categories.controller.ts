import { Controller, Get, Query, UseGuards, Req } from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
} from '@nestjs/swagger';
import { CategoriesService } from './categories.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { HouseholdGuard } from '../households/guards/household.guard';
import type { HouseholdRequest } from '../households/interfaces/household-request.interface';

// Read-only category API: the ledger UI (VEG-401) reads the household's seeded
// categories to populate its category picker. Full category management (create/
// rename/reorder/archive) is the Phase 3 budgeting epic.
@ApiTags('Categories')
@ApiBearerAuth()
@Controller('categories')
@UseGuards(JwtAuthGuard, HouseholdGuard)
export class CategoriesController {
  constructor(private readonly categoriesService: CategoriesService) {}

  @Get()
  @ApiOperation({ summary: "List the household's categories" })
  @ApiResponse({ status: 200, description: 'List of categories' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  findAll(
    @Req() req: HouseholdRequest,
    @Query('includeArchived') includeArchived?: string,
  ) {
    return this.categoriesService.listCategories(
      req.household.householdId,
      includeArchived === 'true',
    );
  }

  @Get('groups')
  @ApiOperation({ summary: "List the household's category groups" })
  @ApiResponse({ status: 200, description: 'List of category groups' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  findGroups(@Req() req: HouseholdRequest) {
    return this.categoriesService.listGroups(req.household.householdId);
  }
}
