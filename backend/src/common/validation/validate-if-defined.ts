import { ValidateIf } from 'class-validator';

/**
 * Run the field's validators whenever the property is present — including an
 * explicit JSON null. @IsOptional would skip null entirely, letting it through
 * to Mongoose where a required path turns it into a 500; with this decorator a
 * null fails the field's validators and surfaces as a 400. Use on update-DTO
 * fields in place of @IsOptional.
 */
export const ValidateIfDefined = ValidateIf(
  (_object, value) => value !== undefined,
);
