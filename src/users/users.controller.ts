import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
} from '@nestjs/common';
import { CurrentUser } from '@nestjs/authentication';
import { Can } from '@nestjs/authorization';
import { ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '../auth/auth.types.js';
import { UserDto } from '../auth/dto/auth.dto.js';
import { AuditService } from '../audit/audit.service.js';
import { UserPolicy } from './user.policy.js';
import { UsersService } from './users.service.js';
import {
  AdminUserDto,
  ListUsersQueryDto,
  UpdateProfileDto,
  UpdateUserDto,
  UserPageDto,
} from './users.dto.js';

@ApiTags('users')
@Controller('users')
export class UsersController {
  constructor(
    private readonly users: UsersService,
    private readonly audit: AuditService,
  ) {}

  @Can.Anyone()
  @Get('me')
  me(@CurrentUser() user: AuthUser): UserDto {
    return user;
  }

  @Can.Anyone()
  @Patch('me')
  updateMe(
    @CurrentUser() user: AuthUser,
    @Body() dto: UpdateProfileDto,
  ): Promise<UserDto> {
    return this.users.updateProfile(user.id, dto);
  }

  @Can(UserPolicy, 'manage')
  @Get()
  list(@Query() query: ListUsersQueryDto): Promise<UserPageDto> {
    return this.users.list(query);
  }

  @Can(UserPolicy, 'view', (ctx) => [
    ctx.switchToHttp().getRequest<{ params: { id: string } }>().params.id,
  ])
  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string): Promise<AdminUserDto> {
    return this.users.get(id);
  }

  @Can(UserPolicy, 'manage')
  @Get(':id/activity')
  activity(@Param('id', ParseUUIDPipe) id: string) {
    return this.audit.forUser(id);
  }

  @Can(UserPolicy, 'manage')
  @Patch(':id')
  update(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUserDto,
  ): Promise<AdminUserDto> {
    return this.users.update(id, dto, actor.id);
  }

  @Can(UserPolicy, 'manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Delete(':id')
  deactivate(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.users.deactivate(id, actor.id);
  }
}
