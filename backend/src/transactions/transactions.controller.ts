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
import { TransactionsService } from './transactions.service';
import { CreateTransactionDto } from './dto/create-transaction.dto';
import { UpdateTransactionDto } from './dto/update-transaction.dto';
import { QueryTransactionDto } from './dto/query-transaction.dto';
import { ImportTransactionsDto } from './dto/import-transactions.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { HouseholdGuard } from '../households/guards/household.guard';
import { ParseObjectIdPipe } from '../common/pipes/parse-object-id.pipe';
import type { HouseholdRequest } from '../households/interfaces/household-request.interface';

@ApiTags('Transactions')
@ApiBearerAuth()
@Controller('transactions')
@UseGuards(JwtAuthGuard, HouseholdGuard)
export class TransactionsController {
  constructor(private readonly transactionsService: TransactionsService) {}

  @Post()
  @ApiOperation({
    summary: 'Create a transaction (income, expense, or transfer)',
  })
  @ApiResponse({ status: 201, description: 'Transaction created' })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  create(
    @Req() req: HouseholdRequest,
    @Body() createDto: CreateTransactionDto,
  ) {
    return this.transactionsService.create(
      req.household.householdId,
      req.household.memberId,
      createDto,
    );
  }

  @Post('import')
  @ApiOperation({
    summary: 'Bulk-import parsed CSV rows into an account',
    description:
      'Accepts parsed rows + a column mapping + target account. Parses amounts ' +
      'to integer cents, maps categories by name, skips duplicate rows, and ' +
      'adjusts the account balance once. Returns imported/skipped counts and ' +
      'per-row errors.',
  })
  @ApiResponse({ status: 201, description: 'Import result' })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  import(
    @Req() req: HouseholdRequest,
    @Body() importDto: ImportTransactionsDto,
  ) {
    return this.transactionsService.importTransactions(
      req.household.householdId,
      req.household.memberId,
      importDto,
    );
  }

  @Get()
  @ApiOperation({ summary: "List the household's transactions" })
  @ApiResponse({ status: 200, description: 'Paginated list of transactions' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  findAll(@Req() req: HouseholdRequest, @Query() query: QueryTransactionDto) {
    return this.transactionsService.findAll(req.household.householdId, query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a transaction by ID' })
  @ApiResponse({ status: 200, description: 'Transaction found' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Transaction not found' })
  findOne(
    @Req() req: HouseholdRequest,
    @Param('id', ParseObjectIdPipe) id: string,
  ) {
    return this.transactionsService.findOne(req.household.householdId, id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a transaction' })
  @ApiResponse({ status: 200, description: 'Transaction updated' })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Transaction not found' })
  update(
    @Req() req: HouseholdRequest,
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() updateDto: UpdateTransactionDto,
  ) {
    return this.transactionsService.update(
      req.household.householdId,
      id,
      updateDto,
    );
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete a transaction (reverses its balance effect)',
  })
  @ApiResponse({ status: 204, description: 'Transaction deleted' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Transaction not found' })
  remove(
    @Req() req: HouseholdRequest,
    @Param('id', ParseObjectIdPipe) id: string,
  ) {
    return this.transactionsService.remove(req.household.householdId, id);
  }
}
