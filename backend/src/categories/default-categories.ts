// The default category set seeded into every new household (and backfilled into
// existing ones). Modeled on common envelope-budgeting templates (EveryDollar /
// YNAB). Phase 2 only seeds and reads these; households can manage their own set
// once the Phase 3 budgeting epic ships category management.
//
// Ordering: groups carry an explicit sortOrder by array position; categories
// likewise within their group. Income is the first group so paycheck categories
// surface at the top of pickers.

export interface DefaultCategory {
  name: string;
  isIncome: boolean;
}

export interface DefaultCategoryGroup {
  name: string;
  categories: DefaultCategory[];
}

export const DEFAULT_CATEGORY_GROUPS: DefaultCategoryGroup[] = [
  {
    name: 'Income',
    categories: [
      { name: 'Paycheck', isIncome: true },
      { name: 'Other Income', isIncome: true },
    ],
  },
  {
    name: 'Housing',
    categories: [
      { name: 'Rent/Mortgage', isIncome: false },
      { name: 'Utilities', isIncome: false },
      { name: 'Internet & Phone', isIncome: false },
    ],
  },
  {
    name: 'Transportation',
    categories: [
      { name: 'Gas', isIncome: false },
      { name: 'Auto Insurance', isIncome: false },
      { name: 'Public Transit', isIncome: false },
    ],
  },
  {
    name: 'Food',
    categories: [
      { name: 'Groceries', isIncome: false },
      { name: 'Restaurants', isIncome: false },
    ],
  },
  {
    name: 'Personal',
    categories: [
      { name: 'Subscriptions', isIncome: false },
      { name: 'Entertainment', isIncome: false },
      { name: 'Clothing', isIncome: false },
    ],
  },
  {
    name: 'Health',
    categories: [
      { name: 'Medical', isIncome: false },
      { name: 'Pharmacy', isIncome: false },
    ],
  },
  {
    name: 'Savings',
    categories: [
      { name: 'Emergency Fund', isIncome: false },
      { name: 'Savings', isIncome: false },
    ],
  },
  {
    name: 'Other',
    categories: [{ name: 'Miscellaneous', isIncome: false }],
  },
];
