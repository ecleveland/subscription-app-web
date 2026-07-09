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
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
} from '@nestjs/swagger';
import { CategoriesService } from './categories.service';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';
import { ReorderCategoriesDto } from './dto/reorder-categories.dto';
import { ReorderCategoryGroupsDto } from './dto/reorder-category-groups.dto';
import { CreateCategoryGroupDto } from './dto/create-category-group.dto';
import { UpdateCategoryGroupDto } from './dto/update-category-group.dto';
import { RemoveCategoryOutcomeDto } from './dto/remove-category-outcome.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { HouseholdGuard } from '../households/guards/household.guard';
import { ParseObjectIdPipe } from '../common/pipes/parse-object-id.pipe';
import type { HouseholdRequest } from '../households/interfaces/household-request.interface';

// Household category management (VEG-437): reads for the ledger UI's pickers,
// plus create/rename/archive/reorder for categories and their groups. Every
// route is household-scoped by HouseholdGuard; ids in paths/bodies are always
// re-validated against the caller's household, never trusted. Any active
// household member may write (same policy as the budget API); a per-role gate
// is a deliberate deferral.
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

  @Post()
  @ApiOperation({ summary: 'Create a category in one of the household groups' })
  @ApiResponse({ status: 201, description: 'Created category' })
  @ApiResponse({ status: 400, description: 'Validation error / foreign group' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 409, description: 'Duplicate name in the group' })
  create(@Req() req: HouseholdRequest, @Body() dto: CreateCategoryDto) {
    return this.categoriesService.createCategory(
      req.household.householdId,
      dto,
    );
  }

  @Post('reorder')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Batch-set category display order',
    description:
      'Each listed category gets sortOrder = its array index. Partial lists ' +
      'are allowed (send one group at a time); unlisted categories keep their ' +
      'order. Returns the refreshed category list, archived included.',
  })
  @ApiResponse({ status: 200, description: 'Reordered category list' })
  @ApiResponse({
    status: 400,
    description: 'Validation error / foreign category',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  reorder(@Req() req: HouseholdRequest, @Body() dto: ReorderCategoriesDto) {
    return this.categoriesService.reorderCategories(
      req.household.householdId,
      dto.categoryIds,
    );
  }

  @Get('groups')
  @ApiOperation({ summary: "List the household's category groups" })
  @ApiResponse({ status: 200, description: 'List of category groups' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  findGroups(@Req() req: HouseholdRequest) {
    return this.categoriesService.listGroups(req.household.householdId);
  }

  @Post('groups')
  @ApiOperation({ summary: 'Create a category group' })
  @ApiResponse({ status: 201, description: 'Created group' })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 409, description: 'Duplicate group name' })
  createGroup(
    @Req() req: HouseholdRequest,
    @Body() dto: CreateCategoryGroupDto,
  ) {
    return this.categoriesService.createGroup(req.household.householdId, dto);
  }

  @Post('groups/reorder')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Batch-set category-group display order',
    description:
      'Each listed group gets sortOrder = its array index. Partial lists ' +
      'are allowed; unlisted groups keep their order. Returns the refreshed ' +
      'group list.',
  })
  @ApiResponse({ status: 200, description: 'Reordered group list' })
  @ApiResponse({ status: 400, description: 'Validation error / foreign group' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  reorderGroups(
    @Req() req: HouseholdRequest,
    @Body() dto: ReorderCategoryGroupsDto,
  ) {
    return this.categoriesService.reorderGroups(
      req.household.householdId,
      dto.groupIds,
    );
  }

  @Patch('groups/:id')
  @ApiOperation({ summary: 'Rename and/or reorder a category group' })
  @ApiResponse({ status: 200, description: 'Updated group' })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Group not found' })
  @ApiResponse({ status: 409, description: 'Duplicate group name' })
  updateGroup(
    @Req() req: HouseholdRequest,
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: UpdateCategoryGroupDto,
  ) {
    return this.categoriesService.updateGroup(
      req.household.householdId,
      id,
      dto,
    );
  }

  @Delete('groups/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete an empty category group',
    description:
      'Blocked (409) while the group still contains categories — archived ' +
      'ones included. Move them out first (PATCH /categories/:id with a new ' +
      'groupId); deleting only removes categories that nothing references.',
  })
  @ApiResponse({ status: 204, description: 'Group deleted' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Group not found' })
  @ApiResponse({ status: 409, description: 'Group still contains categories' })
  async removeGroup(
    @Req() req: HouseholdRequest,
    @Param('id', ParseObjectIdPipe) id: string,
  ): Promise<void> {
    await this.categoriesService.removeGroup(req.household.householdId, id);
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Update a category (rename, move group, reorder, archive)',
  })
  @ApiResponse({ status: 200, description: 'Updated category' })
  @ApiResponse({ status: 400, description: 'Validation error / foreign group' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Category not found' })
  @ApiResponse({ status: 409, description: 'Duplicate name in the group' })
  update(
    @Req() req: HouseholdRequest,
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: UpdateCategoryDto,
  ) {
    return this.categoriesService.updateCategory(
      req.household.householdId,
      id,
      dto,
    );
  }

  @Delete(':id')
  @ApiOperation({
    summary: 'Delete a category (archives instead when referenced)',
    description:
      'Hard-deletes only when no transaction or budget row references the ' +
      'category; otherwise archives it. The outcome reports which happened.',
  })
  @ApiResponse({
    status: 200,
    description: 'Which fate the category met',
    type: RemoveCategoryOutcomeDto,
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Category not found' })
  remove(
    @Req() req: HouseholdRequest,
    @Param('id', ParseObjectIdPipe) id: string,
  ) {
    return this.categoriesService.removeCategory(req.household.householdId, id);
  }
}
