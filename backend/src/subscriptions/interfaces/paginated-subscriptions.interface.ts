import { SubscriptionDocument } from '../schemas/subscription.schema';

export interface PaginationMeta {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  hasNextPage: boolean;
}

export interface PaginatedSubscriptions {
  data: SubscriptionDocument[];
  meta: PaginationMeta;
}
