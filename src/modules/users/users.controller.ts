import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
} from '@nestjs/common';
import { UsersService } from './users.service.js';
import { GetUser } from '../../common/decorators/get-user.decorator.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { UserRole } from '../../generated/prisma/enums.js';
import { UpdateUserDto } from './dtos/update-user.dto.js';
import { UpdateProfileDto } from './dtos/update-profile.dto.js';
import { PaginationDto } from '../../common/dtos/pagination.dto.js';

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  // profile routes
  @Get('/profile')
  async getProfile(@GetUser('sub') userId: string) {
    return this.usersService.getProfile(userId);
  }

  @Patch('/profile')
  async updateProfile(
    @GetUser('sub') userId: string,
    @Body() updateProfileDto: UpdateProfileDto,
  ) {
    return this.usersService.updateProfile(userId, updateProfileDto);
  }

  // admin routes
  @Roles(UserRole.ADMIN)
  @Get('/')
  async getAllUsers(@Query() paginationDto: PaginationDto) {
    const { page = 1, limit = 10 } = paginationDto;
    return this.usersService.getAllUsers(page, limit);
  }

  @Roles(UserRole.ADMIN)
  @Get('/:id')
  async getUserById(@Param('id', ParseUUIDPipe) id: string) {
    return this.usersService.getUserById(id);
  }

  @Roles(UserRole.ADMIN)
  @Patch('/:id')
  async updateUserById(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updateUserDto: UpdateUserDto,
  ) {
    return this.usersService.updateUserById(id, updateUserDto);
  }

  //this soft deletes a user by setting isActive to false
  @Roles(UserRole.ADMIN)
  @Delete('/:id')
  async deleteUserById(@Param('id', ParseUUIDPipe) id: string) {
    return this.usersService.deleteUserById(id);
  }
}
