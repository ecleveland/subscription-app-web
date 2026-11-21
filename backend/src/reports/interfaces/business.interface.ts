// Response shape for GET /api/reports/business. All money is integer cents.
import type { SpendingCategoryRow } from './spending.interface';

export interface BusinessMonth {
  month: string; // "YYYY-MM"
  expenseCents: number; // gross labeled expense dated in the month
  incomeCents: number; // labeled income dated in the month
  // Labeled expenses dated in the month whose reimbursement status is
  // reimbursed. Bucketed by the expense date, not reimbursedAt, so it reads
  // as the part of expenseCents that has been paid back.
  reimbursedCents: number;
}

export interface BusinessReimbursementRow {
  id: string; // the expense transaction's id
  date: string; // the expense date, ISO 8601
  payee: string | null;
  amountCents: number;
  categoryId: string | null;
  labelId: string; // the label on the expense, a sub-label when rolled up
  // ISO 8601. Only on reimbursed rows.
  reimbursedAt?: string;
  // The income that paid the expense back, or null when none is linked.
  // Only on reimbursed rows.
  reimbursedByTransactionId?: string | null;
}

export interface BusinessReimbursements {
  // Every expense still owed that is dated before the end of the range, with
  // no lower bound, so earlier months' debts stay visible. owedCents and
  // owedCount sum the same rows as owed.
  owedCents: number;
  owedCount: number;
  // Expenses dated inside the range that were paid back.
  reimbursedCents: number;
  owed: BusinessReimbursementRow[]; // sorted by date, oldest first
  reimbursed: BusinessReimbursementRow[]; // sorted by date, newest first
}

export interface BusinessReport {
  from: string; // "YYYY-MM", as requested
  to: string; // "YYYY-MM", as requested
  // The requested label, or null when the report covers every label.
  labelId: string | null;
  // Every month from `from` to `to`, zero-filled.
  months: BusinessMonth[];
  // Expense spend per expense category over the whole range, with the same
  // rules and sort as the spending report. plannedCents is always null
  // because budgets are not per label.
  categories: SpendingCategoryRow[];
  // Labeled expense spend with no live expense category in the household.
  uncategorizedCents: number;
  // Every labeled expense in the range. Always equals the sum of the rows'
  // actualCents plus uncategorizedCents. Gross spend, before reimbursement.
  totalCents: number;
  // Owed expenses through the end of the range and reimbursed ones inside it.
  reimbursements: BusinessReimbursements;
}
