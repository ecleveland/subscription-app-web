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
  billingCycle: 'monthly' | 'yearly';
  nextBillingDate: string;
  category: string;
  notes?: string;
  isActive: boolean;
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
