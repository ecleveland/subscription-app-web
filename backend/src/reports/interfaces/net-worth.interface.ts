// Response shape for GET /api/reports/net-worth. All money is integer cents.
import type { AccountType } from '../../accounts/schemas/account.schema';

export interface NetWorthAccount {
  accountId: string;
  name: string;
  type: AccountType;
  // The balance at the end of the month, derived forward from the account's
  // openingBalanceCents plus every ledger delta dated before the next month.
  // A month before the account's first transaction shows the opening
  // balance. Credit and loan balances are negative when money is owed.
  balanceCents: number;
}

export interface NetWorthMonth {
  month: string; // "YYYY-MM"
  // Sum of checking, savings, cash and investment balances. An account of
  // any other type outside credit and loan counts in neither total.
  assetsCents: number;
  // Sum of credit and loan balances. Negative when money is owed.
  liabilitiesCents: number;
  netWorthCents: number; // assetsCents + liabilitiesCents
  // Every household account that exists by this month, archived ones
  // included, in the account list's order. An account appears from the UTC
  // month of its createdAt onward and is left out of earlier months and
  // their totals.
  accounts: NetWorthAccount[];
}

export interface NetWorthReport {
  months: NetWorthMonth[];
}
