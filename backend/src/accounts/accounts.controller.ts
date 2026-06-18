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
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
} from '@nestjs/swagger';
import { AccountsService } from './accounts.service';
import { CreateAccountDto } from './dto/create-account.dto';
import { UpdateAccountDto } from './dto/update-account.dto';
import { QueryAccountDto } from './dto/query-account.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { HouseholdGuard } from '../households/guards/household.guard';
import { ParseObjectIdPipe } from '../common/pipes/parse-object-id.pipe';
import type { HouseholdRequest } from '../households/interfaces/household-request.interface';

@ApiTags('Accounts')
@ApiBearerAuth()
@Controller('accounts')
@UseGuards(JwtAuthGuard, HouseholdGuard)
export class AccountsController {
  constructor(private readonly accountsService: AccountsService) {}

  @Post()
  @ApiOperation({ summary: 'Create an account' })
  @ApiResponse({ status: 201, description: 'Account created' })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  create(@Req() req: HouseholdRequest, @Body() createDto: CreateAccountDto) {
    return this.accountsService.create(req.household.householdId, createDto);
  }

  @Get()
  @ApiOperation({ summary: "List the household's accounts" })
  @ApiResponse({ status: 200, description: 'List of accounts' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  findAll(@Req() req: HouseholdRequest, @Query() query: QueryAccountDto) {
    return this.accountsService.findAll(
      req.household.householdId,
      query.includeArchived ?? false,
    );
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get an account by ID' })
  @ApiResponse({ status: 200, description: 'Account found' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Account not found' })
  findOne(
    @Req() req: HouseholdRequest,
    @Param('id', ParseObjectIdPipe) id: string,
  ) {
    return this.accountsService.findOne(req.household.householdId, id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update an account' })
  @ApiResponse({ status: 200, description: 'Account updated' })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Account not found' })
  update(
    @Req() req: HouseholdRequest,
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() updateDto: UpdateAccountDto,
  ) {
    return this.accountsService.update(
      req.household.householdId,
      id,
      updateDto,
    );
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Archive an account (soft-delete)',
    description:
      'Accounts are archived rather than hard-deleted so the transactions ' +
      'that reference them (VEG-399) are preserved. Use PATCH with ' +
      '`isArchived: false` to restore.',
  })
  @ApiResponse({ status: 204, description: 'Account archived' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Account not found' })
  async remove(
    @Req() req: HouseholdRequest,
    @Param('id', ParseObjectIdPipe) id: string,
  ) {
    await this.accountsService.archive(req.household.householdId, id);
  }
}
