// Response shape for GET /api/reports/spending. All money is integer cents.
export interface SpendingCategoryRow {
  categoryId: string;
  categoryName: string;
  groupId: string;
  groupName: string;
  actualCents: number; // expense transactions on this category in the month
  // The month's planned amount, or null when the household has no budget row
  // for this category that month. A planned 0 stays 0.
  plannedCents: number | null;
}

export interface SpendingReport {
  month: string; // "YYYY-MM"
  // One row per expense category with spend or a planned amount this month,
  // sorted by actualCents descending, then categoryName ascending. Income
  // categories never appear. Archived categories do.
  categories: SpendingCategoryRow[];
  // Expense spend on a category that is not a live expense category of the
  // household (an unknown id or an income category). It rolls up here
  // instead of dropping out of the report. Transactions with no categoryId at
  // all are dropped and logged by
  // TransactionsService.aggregateMonthlyActualsByCategory, so they never
  // reach this total.
  uncategorizedCents: number;
  // Every expense actual in the month. Always equals the sum of the rows'
  // actualCents plus uncategorizedCents. Per-category actuals match the
  // budget view because they come from the same aggregation. The totals
  // differ by design because the budget view drops orphaned spend and this
  // report keeps it.
  totalCents: number;
}
