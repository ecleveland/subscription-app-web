import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { ReportsService } from './reports.service';
import {
  Transaction,
  TransactionType,
} from '../transactions/schemas/transaction.schema';

type Row = {
  _id: { month: string; type: TransactionType };
  totalCents: number;
};

describe('ReportsService', () => {
  const householdId = new Types.ObjectId().toString();
  let service: ReportsService;
  let transactionModel: { aggregate: jest.Mock };

  function mockRows(rows: Row[]): void {
    transactionModel.aggregate.mockReturnValue({
      exec: jest.fn().mockResolvedValue(rows),
    });
  }

  // The pipeline the service handed to Mongo on its first call.
  function pipeline(): Record<string, any>[] {
    return transactionModel.aggregate.mock.calls[0][0];
  }

  beforeEach(async () => {
    transactionModel = { aggregate: jest.fn() };
    mockRows([]);
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReportsService,
        {
          provide: getModelToken(Transaction.name),
          useValue: transactionModel,
        },
      ],
    }).compile();
    service = module.get(ReportsService);
  });

  describe('getCashFlow', () => {
    it('matches only this household, income and expense, inside the UTC range', async () => {
      await service.getCashFlow(householdId, '2026-03', '2026-04');

      const match = pipeline()[0].$match;
      expect(match.householdId).toBeInstanceOf(Types.ObjectId);
      expect(match.householdId.toString()).toBe(householdId);
      // Transfers are excluded by the type filter.
      expect(match.type).toEqual({
        $in: [TransactionType.INCOME, TransactionType.EXPENSE],
      });
      // The first instant of from through the first instant after to,
      // exclusive. 2026-03-31T23:59:59Z is inside, 2026-05-01T00:00:00Z is not.
      expect(match.date).toEqual({
        $gte: new Date('2026-03-01T00:00:00.000Z'),
        $lt: new Date('2026-05-01T00:00:00.000Z'),
      });
    });

    it('does not filter by account, so a credit card expense counts as expense', async () => {
      await service.getCashFlow(householdId, '2026-03', '2026-03');
      const match = pipeline()[0].$match;
      expect(match).not.toHaveProperty('accountId');
      expect(match).not.toHaveProperty('transferAccountId');
    });

    it('groups by the UTC year-month of date and type', async () => {
      await service.getCashFlow(householdId, '2026-03', '2026-04');
      const group = pipeline()[1].$group;
      expect(group._id).toEqual({
        month: {
          $dateToString: { format: '%Y-%m', date: '$date', timezone: 'UTC' },
        },
        type: '$type',
      });
      expect(group.totalCents).toEqual({ $sum: '$amountCents' });
    });

    it('zero-fills an empty month inside the range', async () => {
      mockRows([
        {
          _id: { month: '2026-01', type: TransactionType.INCOME },
          totalCents: 500000,
        },
        {
          _id: { month: '2026-03', type: TransactionType.EXPENSE },
          totalCents: 12000,
        },
      ]);

      const result = await service.getCashFlow(
        householdId,
        '2026-01',
        '2026-03',
      );

      expect(result).toEqual({
        months: [
          {
            month: '2026-01',
            incomeCents: 500000,
            expenseCents: 0,
            netCents: 500000,
          },
          { month: '2026-02', incomeCents: 0, expenseCents: 0, netCents: 0 },
          {
            month: '2026-03',
            incomeCents: 0,
            expenseCents: 12000,
            netCents: -12000,
          },
        ],
      });
    });

    it('returns all-zero months when the household has no transactions', async () => {
      const result = await service.getCashFlow(
        householdId,
        '2026-11',
        '2027-01',
      );
      expect(result.months.map((m) => m.month)).toEqual([
        '2026-11',
        '2026-12',
        '2027-01',
      ]);
      expect(
        result.months.every(
          (m) =>
            m.incomeCents === 0 && m.expenseCents === 0 && m.netCents === 0,
        ),
      ).toBe(true);
    });

    it('computes netCents as income minus expense', async () => {
      mockRows([
        {
          _id: { month: '2026-03', type: TransactionType.INCOME },
          totalCents: 310000,
        },
        {
          _id: { month: '2026-03', type: TransactionType.EXPENSE },
          totalCents: 86000,
        },
        {
          _id: { month: '2026-04', type: TransactionType.INCOME },
          totalCents: 1000,
        },
        {
          _id: { month: '2026-04', type: TransactionType.EXPENSE },
          totalCents: 4500,
        },
      ]);

      const result = await service.getCashFlow(
        householdId,
        '2026-03',
        '2026-04',
      );

      expect(result.months).toEqual([
        {
          month: '2026-03',
          incomeCents: 310000,
          expenseCents: 86000,
          netCents: 224000,
        },
        {
          month: '2026-04',
          incomeCents: 1000,
          expenseCents: 4500,
          netCents: -3500,
        },
      ]);
    });

    it('puts the last second of a month and the first second of the next in separate months', async () => {
      // Mongo does the bucketing, so this pins the contract the service relies
      // on: rows keyed by month land on that month and nowhere else. The e2e
      // suite checks the real boundary against a database.
      mockRows([
        {
          _id: { month: '2026-03', type: TransactionType.EXPENSE },
          totalCents: 100,
        },
        {
          _id: { month: '2026-04', type: TransactionType.EXPENSE },
          totalCents: 200,
        },
      ]);
      const result = await service.getCashFlow(
        householdId,
        '2026-03',
        '2026-04',
      );
      expect(result.months.map((m) => m.expenseCents)).toEqual([100, 200]);
    });

    it('ignores a row outside the requested months instead of adding a month', async () => {
      mockRows([
        {
          _id: { month: '2025-12', type: TransactionType.INCOME },
          totalCents: 999,
        },
      ]);
      const result = await service.getCashFlow(
        householdId,
        '2026-01',
        '2026-01',
      );
      expect(result.months).toEqual([
        { month: '2026-01', incomeCents: 0, expenseCents: 0, netCents: 0 },
      ]);
    });
  });
});
