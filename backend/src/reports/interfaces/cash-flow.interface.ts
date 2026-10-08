// Response shape for GET /api/reports/cash-flow. All money is integer cents.
export interface CashFlowMonth {
  month: string; // "YYYY-MM"
  incomeCents: number;
  expenseCents: number;
  netCents: number; // incomeCents - expenseCents
}

export interface CashFlowReport {
  months: CashFlowMonth[];
}
