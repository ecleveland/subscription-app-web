// The labelId list filter on /transactions and /recurring: a label id, or
// 'none' for records without a label (personal).
export const LABEL_FILTER_NONE = 'none';
export const LABEL_FILTER_PATTERN = /^(none|[0-9a-fA-F]{24})$/;
export const LABEL_FILTER_MESSAGE =
  "labelId must be a label id or 'none' for unlabeled records";
