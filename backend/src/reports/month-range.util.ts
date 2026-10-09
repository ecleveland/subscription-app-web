// Month arithmetic for "YYYY-MM" report ranges. Callers validate the format
// first (MONTH_REGEX in budgets/budget-month.util); these helpers assume it.

/** Months since year 0, so two months compare and subtract as integers. */
export function monthIndex(month: string): number {
  const [year, monthNumber] = month.split('-').map(Number);
  return year * 12 + (monthNumber - 1);
}

/** The monthIndex of the UTC month that contains `date`. */
export function monthIndexOfDate(date: Date): number {
  return date.getUTCFullYear() * 12 + date.getUTCMonth();
}

function monthFromIndex(index: number): string {
  const year = Math.floor(index / 12);
  const monthNumber = (index % 12) + 1;
  return `${String(year).padStart(4, '0')}-${String(monthNumber).padStart(2, '0')}`;
}

/** Every month from `from` to `to`, inclusive. Empty when from is after to. */
export function monthsInRange(from: string, to: string): string[] {
  const months: string[] = [];
  for (let i = monthIndex(from); i <= monthIndex(to); i++) {
    months.push(monthFromIndex(i));
  }
  return months;
}
