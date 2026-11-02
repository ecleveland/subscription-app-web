import { Types } from 'mongoose';

// The labelId list filter on /transactions and /recurring takes a label id, or
// 'none' for records without a label (personal).
export const LABEL_FILTER_NONE = 'none';
export const LABEL_FILTER_PATTERN = new RegExp(
  `^(${LABEL_FILTER_NONE}|[0-9a-fA-F]{24})$`,
);
export const LABEL_FILTER_MESSAGE = `labelId must be a label id or '${LABEL_FILTER_NONE}' for unlabeled records`;

// The Mongo filter value for a validated labelId query param. null matches
// both a missing field and an explicit null, so 'none' returns every personal
// record however it was written.
export function labelFilterValue(raw: string): Types.ObjectId | null {
  return raw === LABEL_FILTER_NONE ? null : new Types.ObjectId(raw);
}
