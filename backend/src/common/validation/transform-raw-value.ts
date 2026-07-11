import { Transform, TransformFnParams } from 'class-transformer';

/**
 * Restore the raw request value for validation: with the global
 * ValidationPipe's enableImplicitConversion, class-transformer coerces by
 * declared type BEFORE validators run — most damagingly, the string "false"
 * becomes boolean true. Reading the pre-coercion value off the plain object
 * (class-transformer supplies the property key) lets @IsBoolean reject a
 * string with a 400 instead of silently inverting it.
 */
export const TransformRawValue = Transform(
  ({ obj, key }: TransformFnParams) => (obj as Record<string, unknown>)[key],
);

/**
 * Boolean query-param coercion: query strings arrive as strings, so map the
 * boolean-ish literals to real booleans and pass anything else through
 * unchanged for @IsBoolean to reject as a 400 (never guess a garbage value).
 * Reads the raw pre-coercion value for the same reason as TransformRawValue.
 */
export const TransformBooleanParam = Transform(
  ({ obj, key }: TransformFnParams): unknown => {
    const raw = (obj as Record<string, unknown>)[key];
    if (raw === true || raw === 'true') return true;
    if (raw === false || raw === 'false') return false;
    return raw;
  },
);

/**
 * Trim a string before validation, passing non-strings through untouched for
 * the type validator to reject. Pairs with @IsNotEmpty on fields whose schema
 * path also trims: without it a whitespace-only value passes DTO validation,
 * trims to "" at save time, and fails the schema's required check as a 500.
 */
export const TrimString = Transform(({ value }: TransformFnParams) =>
  typeof value === 'string' ? value.trim() : (value as unknown),
);
