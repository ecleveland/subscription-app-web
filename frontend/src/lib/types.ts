export interface User {
  _id: string;
  username: string;
  displayName?: string;
  email?: string;
  avatarUrl?: string;
  role: 'user' | 'admin';
  createdAt: string;
  updatedAt: string;
}

export interface Subscription {
  _id: string;
  userId: string;
  name: string;
  cost: number;
  billingCycle: 'weekly' | 'monthly' | 'yearly';
  nextBillingDate: string;
  category: string;
  notes?: string;
  tags?: string[];
  isActive: boolean;
  reminderDaysBefore: number;
  trialEndDate?: string;
  sharedWith?: number | null;
  createdAt: string;
  updatedAt: string;
}

export type HouseholdRole = 'owner' | 'adult' | 'teen' | 'viewer';
export type MembershipStatus = 'active' | 'invited';
export type InvitationStatus = 'pending' | 'accepted' | 'revoked' | 'expired';

/** Roles that can be granted via invitation (the owner role cannot). */
export const INVITE_ROLES = ['adult', 'teen', 'viewer'] as const;
export type InviteRole = (typeof INVITE_ROLES)[number];

export interface Household {
  _id: string;
  name: string;
  currency: string;
  ownerId: string;
  createdAt: string;
  updatedAt: string;
}

/** The user fields the backend populates onto each member row. */
export interface HouseholdMemberUser {
  _id: string;
  username: string;
  displayName?: string;
  email?: string;
}

export interface HouseholdMember {
  _id: string;
  householdId: string;
  userId: HouseholdMemberUser;
  role: HouseholdRole;
  status: MembershipStatus;
  joinedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface HouseholdWithMembers {
  household: Household;
  members: HouseholdMember[];
}

/** Response from creating an invitation — includes the shareable link. */
export interface InviteResult {
  id: string;
  householdId: string;
  email: string;
  role: HouseholdRole;
  status: InvitationStatus;
  expiresAt: string;
  inviteUrl: string;
}

export const CATEGORIES = [
  'Streaming',
  'Software',
  'Gaming',
  'Cloud Storage',
  'News & Media',
  'Health & Fitness',
  'Education',
  'Utilities',
  'Other',
] as const;

export type Category = (typeof CATEGORIES)[number];

// --- Budgeting (Phase 2): accounts, transactions, categories ----------------
// All money is integer minor units (cents); convert to display strings only at
// the UI boundary (see formatCents).

export type AccountType =
  | 'checking'
  | 'savings'
  | 'credit'
  | 'cash'
  | 'investment'
  | 'loan';

export const ACCOUNT_TYPES: readonly AccountType[] = [
  'checking',
  'savings',
  'credit',
  'cash',
  'investment',
  'loan',
];

export interface Account {
  _id: string;
  householdId: string;
  name: string;
  type: AccountType;
  balanceCents: number;
  isArchived: boolean;
  createdAt: string;
  updatedAt: string;
}

export type TransactionType = 'income' | 'expense' | 'transfer';

export interface Transaction {
  _id: string;
  householdId: string;
  accountId: string;
  categoryId?: string;
  memberId?: string;
  type: TransactionType;
  amountCents: number;
  date: string;
  payee?: string;
  notes?: string;
  tags?: string[];
  cleared: boolean;
  transferAccountId?: string;
  recurringId?: string;
  createdAt: string;
  updatedAt: string;
}

// --- Recurring & bills (Phase 4) --------------------------------------------
// A recurring schedule (bill or scheduled income). Materializes into ledger
// Transactions when due; a subscription is the `isSubscription: true` slice.

export type RecurringType = 'income' | 'expense';
export type RecurringCadence = 'weekly' | 'monthly' | 'yearly';

export interface RecurringTransaction {
  _id: string;
  householdId: string;
  // Optional: legacy migrated subscriptions may lack an account, though the
  // create API requires one.
  accountId?: string;
  categoryId: string;
  memberId?: string;
  type: RecurringType;
  amountCents: number;
  payee: string;
  notes?: string;
  tags?: string[];
  cadence: RecurringCadence;
  nextDate: string;
  cadenceAnchorDay?: number;
  reminderDaysBefore: number;
  endDate?: string;
  isActive: boolean;
  isSubscription: boolean;
  sharedWith?: number | null;
  createdAt: string;
  updatedAt: string;
}

// A named grouping of budgeting categories (e.g. "Housing", "Food") used for
// display ordering on the category management page.
export interface CategoryGroup {
  _id: string;
  householdId: string;
  name: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

// The seeded budgeting category the ledger references (distinct from the
// subscription `Category` string union above).
export interface BudgetCategory {
  _id: string;
  householdId: string;
  groupId: string;
  name: string;
  isIncome: boolean;
  sortOrder: number;
  isArchived: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ImportRowError {
  row: number;
  message: string;
}

export interface ImportResult {
  imported: number;
  skipped: number;
  errors: ImportRowError[];
}

export interface AppNotification {
  _id: string;
  userId: string;
  subscriptionId: string;
  type: 'renewal_reminder';
  title: string;
  message: string;
  read: boolean;
  billingDate: string;
  createdAt: string;
  updatedAt: string;
}

export interface NotificationsResponse {
  data: AppNotification[];
  unreadCount: number;
}

export type BulkAction = 'delete' | 'activate' | 'deactivate' | 'changeCategory';

export interface BulkOperationResult {
  success: number;
  failed: number;
}

export interface PaginationMeta {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  hasNextPage: boolean;
}

export interface PaginatedResponse<T> {
  data: T[];
  meta: PaginationMeta;
}
