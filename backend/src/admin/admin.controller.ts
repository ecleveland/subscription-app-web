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
  Logger,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ParseObjectIdPipe } from '../common/pipes/parse-object-id.pipe';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import type { AuthenticatedRequest } from '../auth/interfaces/jwt-payload.interface';
import { UserRole } from '../users/schemas/user.schema';
import { UsersService } from '../users/users.service';
import { CreateUserDto } from '../users/dto/create-user.dto';
import { AdminUpdateUserDto } from '../users/dto/admin-update-user.dto';

@ApiTags('Admin')
@ApiBearerAuth()
@Controller('admin/users')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminController {
  private readonly logger = new Logger(AdminController.name);

  constructor(private readonly usersService: UsersService) {}

  @Get()
  @ApiOperation({ summary: 'List all users' })
  @ApiResponse({ status: 200, description: 'List of users' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden — admin only' })
  findAll() {
    return this.usersService.findAll();
  }

  @Post()
  @ApiOperation({ summary: 'Create a user' })
  @ApiResponse({ status: 201, description: 'User created' })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden — admin only' })
  async create(
    @Req() req: AuthenticatedRequest,
    @Body() createUserDto: CreateUserDto,
  ) {
    const result = await this.usersService.create(createUserDto);
    this.logger.log(
      { adminId: req.user.userId, targetUserId: result._id.toString() },
      'Admin created user',
    );
    return result;
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a user by ID' })
  @ApiResponse({ status: 200, description: 'User found' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden — admin only' })
  @ApiResponse({ status: 404, description: 'User not found' })
  findOne(@Param('id', ParseObjectIdPipe) id: string) {
    return this.usersService.findOnePublic(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a user' })
  @ApiResponse({ status: 200, description: 'User updated' })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden — admin only' })
  @ApiResponse({ status: 404, description: 'User not found' })
  async update(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() updateDto: AdminUpdateUserDto,
  ) {
    // Demoting an admin? Do it atomically so two concurrent demotes can't race
    // the last admin away (demoteAdminSafely demotes-then-counts and rolls back
    // if it left zero admins). No-op when the target isn't an admin.
    if (updateDto.role && updateDto.role !== UserRole.ADMIN) {
      await this.usersService.demoteAdminSafely(id);
    }
    const result = await this.usersService.update(id, updateDto);
    this.logger.log(
      { adminId: req.user.userId, targetUserId: id },
      'Admin updated user',
    );
    return result;
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a user' })
  @ApiResponse({ status: 204, description: 'User deleted' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden — admin only' })
  @ApiResponse({ status: 404, description: 'User not found' })
  async remove(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseObjectIdPipe) id: string,
  ) {
    if (req.user.userId === id) {
      throw new ForbiddenException('Cannot delete your own account');
    }
    // Demote-then-delete: demoteAdminSafely atomically guarantees we never strip
    // the last admin (throws if so; no-op for non-admins). Once demoted, the
    // now-USER account no longer affects the admin count, so the delete is safe
    // under concurrency without multi-document transactions.
    const demoted = await this.usersService.demoteAdminSafely(id);
    try {
      await this.usersService.remove(id);
    } catch (err) {
      // The delete failed after we demoted — restore the prior admin role so a
      // failed delete doesn't silently strip admin (best-effort; the user may
      // already be partially removed, in which case re-promote no-ops).
      if (demoted) {
        await this.usersService
          .update(id, { role: UserRole.ADMIN })
          .catch((rollbackErr: unknown) =>
            this.logger.error(
              { targetUserId: id, rollbackErr },
              'Failed to restore admin role after a failed delete',
            ),
          );
      }
      throw err;
    }
    this.logger.log(
      { adminId: req.user.userId, targetUserId: id },
      'Admin deleted user',
    );
  }
}
