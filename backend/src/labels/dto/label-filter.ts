import { Types } from 'mongoose';

// The labelId list filter on /transactions, /recurring and the reports takes a
// label id, 'none' for records without a label (personal), or 'any' for
// records with any label (business).
export const LABEL_FILTER_NONE = 'none';
export const LABEL_FILTER_ANY = 'any';
export const LABEL_FILTER_PATTERN = new RegExp(
  `^(${LABEL_FILTER_NONE}|${LABEL_FILTER_ANY}|[0-9a-fA-F]{24})$`,
);
export const LABEL_FILTER_MESSAGE = `labelId must be a label id, '${LABEL_FILTER_NONE}' for unlabeled records or '${LABEL_FILTER_ANY}' for labeled records`;

// The Mongo filter value for a validated labelId query param. null matches
// both a missing field and an explicit null, so 'none' returns every personal
// record however it was written. { $ne: null } is its complement.
export function labelFilterValue(
  raw: string,
): Types.ObjectId | null | { $ne: null } {
  if (raw === LABEL_FILTER_NONE) {
    return null;
  }
  if (raw === LABEL_FILTER_ANY) {
    return { $ne: null };
  }
  return new Types.ObjectId(raw);
}
