import { IsEmail, IsEnum, IsNotIn, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { HouseholdRole } from '../schemas/household-member.schema';

export class InviteMemberDto {
  @ApiProperty({
    description: 'Email address of the person being invited',
    example: 'partner@example.com',
  })
  @IsEmail()
  email: string;

  @ApiPropertyOptional({
    description:
      'Household role to grant on acceptance (defaults to adult). The owner ' +
      'role cannot be granted via invitation.',
    enum: [HouseholdRole.ADULT, HouseholdRole.TEEN, HouseholdRole.VIEWER],
    default: HouseholdRole.ADULT,
  })
  @IsOptional()
  @IsEnum(HouseholdRole)
  @IsNotIn([HouseholdRole.OWNER], {
    message: 'Cannot invite a member as owner',
  })
  role?: HouseholdRole;
}
