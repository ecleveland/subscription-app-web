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
  createdAt: string;
  updatedAt: string;
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
