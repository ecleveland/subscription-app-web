import {
  Controller,
  Get,
  Patch,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  UseGuards,
  Req,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { AuthenticatedRequest } from '../auth/interfaces/jwt-payload.interface';
import { UsersService } from './users.service';
import { UpdateUserDto } from './dto/update-user.dto';
import { ChangePasswordDto } from './dto/change-password.dto';

@Controller('users')
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('me')
  getProfile(@Req() req: AuthenticatedRequest) {
    return this.usersService.findOnePublic(req.user.userId);
  }

  @Patch('me')
  updateProfile(
    @Req() req: AuthenticatedRequest,
    @Body() updateDto: UpdateUserDto,
  ) {
    return this.usersService.update(req.user.userId, updateDto);
  }

  @Post('me/change-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  changePassword(
    @Req() req: AuthenticatedRequest,
    @Body() dto: ChangePasswordDto,
  ) {
    return this.usersService.changePassword(
      req.user.userId,
      dto.currentPassword,
      dto.newPassword,
    );
  }
}
