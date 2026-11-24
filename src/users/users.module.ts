import { Module } from '@nestjs/common';
import { UsersController } from './users.controller.js';
import { UsersService } from './users.service.js';
import { UserPolicy } from './user.policy.js';

@Module({
  controllers: [UsersController],
  providers: [UsersService, UserPolicy],
})
export class UsersModule {}
