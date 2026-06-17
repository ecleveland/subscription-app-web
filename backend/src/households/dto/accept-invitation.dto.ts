import { IsNotEmpty, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class AcceptInvitationDto {
  @ApiProperty({
    description: 'The raw invitation token delivered by email',
    example: 'a1b2c3d4...',
  })
  @IsString()
  @IsNotEmpty()
  token: string;
}
