import { AccountType } from '../accounts/schemas/account.schema';
import { GoalType } from './schemas/goal.schema';
import { accountFitsGoal } from './goal-account-pairing';

describe('accountFitsGoal', () => {
  it.each([
    [AccountType.CHECKING, true],
    [AccountType.SAVINGS, true],
    [AccountType.CASH, true],
    [AccountType.INVESTMENT, true],
    [AccountType.CREDIT, false],
    [AccountType.LOAN, false],
  ])('a savings goal tracking a %s account fits: %s', (accountType, fits) => {
    expect(accountFitsGoal(GoalType.SAVINGS, accountType)).toBe(fits);
  });

  it.each([
    [AccountType.CHECKING, false],
    [AccountType.SAVINGS, false],
    [AccountType.CASH, false],
    [AccountType.INVESTMENT, false],
    [AccountType.CREDIT, true],
    [AccountType.LOAN, true],
  ])('a debt goal tracking a %s account fits: %s', (accountType, fits) => {
    expect(accountFitsGoal(GoalType.DEBT, accountType)).toBe(fits);
  });
});
