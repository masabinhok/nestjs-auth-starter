import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { UpdateProfileDto } from './dtos/update-profile.dto';
import { User } from 'generated/prisma/client';
import { UpdateUserDto } from './dtos/update-user.dto';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async getProfile(userId: string) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId },
    });

    return this.sanitizeUser(user);
  }

  async updateProfile(userId: string, updateProfileDto: UpdateProfileDto) {
    const updatedUser = await this.prisma.user.update({
      where: { id: userId },
      data: { ...updateProfileDto },
    });
    return this.sanitizeUser(updatedUser);
  }

  // admin methods
  async getAllUsers(page: number = 1, limit: number = 10) {
    const skip = (page - 1) * limit;

    const [users, total] = await Promise.all([
      this.prisma.user.findMany({
        where: { isActive: true },
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.user.count({ where: { isActive: true } }),
    ]);

    const sanitizedUsers = users.map((user) => this.sanitizeUser(user));
    const totalPages = Math.ceil(total / limit);

    return {
      data: sanitizedUsers,
      meta: {
        total,
        page,
        limit,
        totalPages,
        hasNext: page < totalPages,
        hasPrevious: page > 1,
      },
    };
  }

  async getUserById(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return this.sanitizeUser(user);
  }

  async updateUserById(userId: string, updateUserDto: UpdateUserDto) {
    const losesAdmin =
      updateUserDto.isActive === false ||
      (updateUserDto.role !== undefined && updateUserDto.role !== 'ADMIN');
    if (losesAdmin) {
      await this.assertNotLastAdmin(userId);
    }

    const updatedUser = await this.prisma.user.update({
      where: { id: userId },
      data: { ...updateUserDto },
    });

    // Role and status are baked into issued tokens; force a fresh login.
    if (updateUserDto.role !== undefined || updateUserDto.isActive === false) {
      await this.prisma.refreshToken.deleteMany({ where: { userId } });
    }

    return this.sanitizeUser(updatedUser);
  }

  async deleteUserById(userId: string) {
    await this.assertNotLastAdmin(userId);

    // Soft delete: set isActive to false instead of hard delete
    await this.prisma.user.update({
      where: { id: userId },
      data: { isActive: false },
    });

    // Also invalidate all refresh tokens for this user
    await this.prisma.refreshToken.deleteMany({
      where: { userId },
    });

    return { message: 'User deleted successfully' };
  }

  // utils

  private async assertNotLastAdmin(userId: string): Promise<void> {
    const target = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!target) {
      throw new NotFoundException('User not found');
    }
    if (target.role !== 'ADMIN' || !target.isActive) {
      return;
    }
    const activeAdmins = await this.prisma.user.count({
      where: { role: 'ADMIN', isActive: true },
    });
    if (activeAdmins <= 1) {
      throw new BadRequestException('Cannot remove the last active admin');
    }
  }

  sanitizeUser(user: User | null) {
    if (!user) {
      return null;
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { refreshToken, passwordHash, ...safeUser } = user;
    return safeUser;
  }
}
