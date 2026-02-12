import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  HttpCode,
  HttpStatus,
  UseGuards,
  Req,
  ForbiddenException,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import type { AuthenticatedRequest } from '../auth/interfaces/jwt-payload.interface';
import { UserRole } from '../users/schemas/user.schema';
import { UsersService } from '../users/users.service';
import { CreateUserDto } from '../users/dto/create-user.dto';
import { AdminUpdateUserDto } from '../users/dto/admin-update-user.dto';

@Controller('admin/users')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  findAll() {
    return this.usersService.findAll();
  }

  @Post()
  create(@Body() createUserDto: CreateUserDto) {
    return this.usersService.create(createUserDto);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.usersService.findOnePublic(id);
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() updateDto: AdminUpdateUserDto) {
    if (updateDto.role && updateDto.role !== UserRole.ADMIN) {
      const user = await this.usersService.findOne(id);
      if (user.role === UserRole.ADMIN) {
        const adminCount = await this.usersService.countAdmins();
        if (adminCount <= 1) {
          throw new ForbiddenException('Cannot remove the last admin');
        }
      }
    }
    return this.usersService.update(id, updateDto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    if (req.user.userId === id) {
      throw new ForbiddenException('Cannot delete your own account');
    }
    const user = await this.usersService.findOne(id);
    if (user.role === UserRole.ADMIN) {
      const adminCount = await this.usersService.countAdmins();
      if (adminCount <= 1) {
        throw new ForbiddenException('Cannot delete the last admin');
      }
    }
    return this.usersService.remove(id);
  }
}
