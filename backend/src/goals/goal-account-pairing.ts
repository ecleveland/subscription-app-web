import {
  ASSET_TYPES,
  AccountType,
  LIABILITY_TYPES,
} from '../accounts/schemas/account.schema';
import { GoalType } from './schemas/goal.schema';

// Which accounts can back each goal type. Asset balances are positive and grow
// as you save. Credit and loan balances are negative and rise toward 0 as you
// pay down, so balanceCents - baselineCents counts up for both goal types.
export const LINKABLE_ACCOUNT_TYPES: Record<
  GoalType,
  ReadonlySet<AccountType>
> = {
  [GoalType.SAVINGS]: ASSET_TYPES,
  [GoalType.DEBT]: LIABILITY_TYPES,
};

/** Whether a goal of this type can track an account of this type. */
export function accountFitsGoal(
  goalType: GoalType,
  accountType: AccountType,
): boolean {
  return LINKABLE_ACCOUNT_TYPES[goalType].has(accountType);
}
