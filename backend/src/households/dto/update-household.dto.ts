import { PartialType } from '@nestjs/swagger';
import { CreateHouseholdDto } from './create-household.dto';

// All fields optional (name, currency) with the same class-validator rules as
// CreateHouseholdDto. Mirrors UpdateSubscriptionDto's PartialType pattern.
export class UpdateHouseholdDto extends PartialType(CreateHouseholdDto) {}
