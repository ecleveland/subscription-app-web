export interface Subscription {
  _id: string;
  name: string;
  cost: number;
  billingCycle: 'monthly' | 'yearly';
  nextBillingDate: string;
  category: string;
  notes?: string;
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
