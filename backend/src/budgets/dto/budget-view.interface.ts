// The computed budget-vs-actual view returned by `GET /budgets/:month`. This is
// an outbound response shape (no class-validator) — all money is integer cents,
// converted to display strings only at the UI boundary. `actualCents` is never
// stored: it is aggregated from the transaction ledger on read.

export interface BudgetCategoryView {
  categoryId: string;
  // The planned monthly limit; 0 when the category has spend but no set limit.
  plannedCents: number;
  // Summed transactions for the category this month (income categories sum
  // income, expense categories sum expense); 0 when there is no spend yet.
  actualCents: number;
  // plannedCents − actualCents; negative signals over-budget so the UI can flag
  // it. (For income categories this is informational.)
  remainingCents: number;
  // Surfaced so the UI can group/style without a second categories fetch.
  isIncome: boolean;
}

export interface BudgetView {
  month: string;
  // Union of {categories with a planned limit} ∪ {categories with spend this
  // month}, so both unspent allocations and unbudgeted overspend are visible.
  categories: BudgetCategoryView[];
  // Sum of planned limits across expense categories only.
  totalPlannedCents: number;
  // Sum of actuals across expense categories only (income rolls into income).
  totalActualCents: number;
  // Sum of all income-type transactions in the month.
  incomeCents: number;
  // Derived: incomeCents − totalPlannedCents. Negative means more is planned
  // than earned; the "to be budgeted" figure for the zero-based layer.
  toBeBudgetedCents: number;
}
