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
