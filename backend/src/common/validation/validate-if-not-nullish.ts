import { ValidateIf } from 'class-validator';

/**
 * Run the field's validators only when the property is present AND non-null:
 * undefined means "unchanged"/"absent" and explicit JSON null is accepted
 * as-is (the null-to-clear wire contract). Use only on fields whose null is a
 * deliberate part of the API; everywhere else use ValidateIfDefined so null
 * fails validation instead of reaching Mongoose.
 */
export const ValidateIfNotNullish = ValidateIf(
  (_object, value) => value !== undefined && value !== null,
);
