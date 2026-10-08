import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, PipelineStage, Types } from 'mongoose';
import {
  Transaction,
  TransactionDocument,
  TransactionType,
} from '../transactions/schemas/transaction.schema';
import { monthToUtcRange } from '../budgets/budget-month.util';
import { monthsInRange } from './month-range.util';
import type {
  CashFlowReport,
  CashFlowMonth,
} from './interfaces/cash-flow.interface';

@Injectable()
export class ReportsService {
  private readonly logger = new Logger(ReportsService.name);

  constructor(
    @InjectModel(Transaction.name)
    private readonly transactionModel: Model<TransactionDocument>,
  ) {}

  /**
   * Income and expense totals per UTC month from `from` to `to` inclusive
   * (both "YYYY-MM", already validated by the query DTO). One aggregation over
   * the ledger, grouped by month and type. Transfers are excluded because they
   * move money between the household's own accounts. Expenses count on every
   * account type, credit cards included. Months with no activity come back as
   * zeros so the caller can chart the range without gaps.
   */
  async getCashFlow(
    householdId: string,
    from: string,
    to: string,
  ): Promise<CashFlowReport> {
    const { start } = monthToUtcRange(from);
    const { end } = monthToUtcRange(to);

    const pipeline: PipelineStage[] = [
      {
        $match: {
          householdId: new Types.ObjectId(householdId),
          type: { $in: [TransactionType.INCOME, TransactionType.EXPENSE] },
          date: { $gte: start, $lt: end },
        },
      },
      {
        $group: {
          _id: {
            month: {
              $dateToString: {
                format: '%Y-%m',
                date: '$date',
                timezone: 'UTC',
              },
            },
            type: '$type',
          },
          totalCents: { $sum: '$amountCents' },
        },
      },
    ];

    const rows = (await this.transactionModel
      .aggregate(pipeline)
      .exec()) as unknown as {
      _id: { month: string; type: TransactionType };
      totalCents: number;
    }[];

    const byMonth = new Map<string, CashFlowMonth>(
      monthsInRange(from, to).map((month) => [
        month,
        { month, incomeCents: 0, expenseCents: 0, netCents: 0 },
      ]),
    );
    for (const row of rows) {
      const entry = byMonth.get(row._id.month);
      // Unreachable while the $match range and the zero-filled months agree.
      // Warn if it ever happens so a range bug shows up instead of cents
      // silently vanishing from the report.
      if (!entry) {
        this.logger.warn(
          { householdId, month: row._id.month },
          'Dropped a cash flow row outside the requested range',
        );
        continue;
      }
      if (row._id.type === TransactionType.INCOME) {
        entry.incomeCents += row.totalCents;
      } else {
        entry.expenseCents += row.totalCents;
      }
    }

    const months = [...byMonth.values()];
    for (const m of months) {
      m.netCents = m.incomeCents - m.expenseCents;
    }
    return { months };
  }
}
