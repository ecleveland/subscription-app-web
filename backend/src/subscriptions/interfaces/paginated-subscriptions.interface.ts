import type { SubscriptionView } from '../subscriptions.service';

export interface PaginationMeta {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  hasNextPage: boolean;
}

export interface PaginatedSubscriptions {
  data: SubscriptionView[];
  meta: PaginationMeta;
}
