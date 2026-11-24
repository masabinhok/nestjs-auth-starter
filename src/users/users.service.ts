import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { SignInService } from '@nestjs/authentication';
import { PrismaService } from '../infra/database/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { pageMeta } from '../common/dto/pagination.dto.js';
import type { Prisma, User } from '../generated/prisma/client.js';
import { toAuthUser } from '../auth/auth.types.js';
import type {
  AdminUserDto,
  ListUsersQueryDto,
  UpdateProfileDto,
  UpdateUserDto,
  UserPageDto,
} from './users.dto.js';

type UserWithMfa = User & { totp: { confirmed: boolean } | null };

/** Responses are built field by field: new columns never leak by default. */
function adminView(user: UserWithMfa): AdminUserDto {
  return {
    ...toAuthUser(user),
    isActive: user.isActive,
    mfaEnabled: user.totp?.confirmed ?? false,
    lockedUntil:
      user.lockedUntil && user.lockedUntil > new Date()
        ? user.lockedUntil
        : null,
    createdAt: user.createdAt,
  };
}

const withMfa = { totp: { select: { confirmed: true } } } as const;

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly signIn: SignInService,
    private readonly audit: AuditService,
  ) {}

  async updateProfile(userId: string, dto: UpdateProfileDto) {
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: { fullName: dto.fullName },
    });
    return toAuthUser(user);
  }

  async list(query: ListUsersQueryDto): Promise<UserPageDto> {
    const where: Prisma.UserWhereInput = query.search
      ? {
          OR: [
            { email: { contains: query.search, mode: 'insensitive' } },
            { fullName: { contains: query.search, mode: 'insensitive' } },
          ],
        }
      : {};
    const [users, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        where,
        include: withMfa,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.user.count({ where }),
    ]);
    return {
      data: users.map(adminView),
      meta: pageMeta(total, query.page, query.limit),
    };
  }

  async get(id: string): Promise<AdminUserDto> {
    const user = await this.prisma.user.findUnique({
      where: { id },
      include: withMfa,
    });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return adminView(user);
  }

  async update(
    id: string,
    dto: UpdateUserDto,
    actorId: string,
  ): Promise<AdminUserDto> {
    const target = await this.prisma.user.findUnique({ where: { id } });
    if (!target) {
      throw new NotFoundException('User not found');
    }
    const losesAdmin =
      target.role === 'ADMIN' &&
      target.isActive &&
      (dto.isActive === false ||
        (dto.role !== undefined && dto.role !== 'ADMIN'));
    if (losesAdmin) {
      await this.assertAnotherAdmin();
    }

    const user = await this.prisma.user.update({
      where: { id },
      data: { fullName: dto.fullName, role: dto.role, isActive: dto.isActive },
      include: withMfa,
    });

    // Sessions and refresh tokens were issued under the old role or status.
    if (dto.role !== undefined || dto.isActive === false) {
      await this.signIn.signOutEverywhere(id);
    }
    await this.audit.record({
      type: 'user-updated-by-admin',
      userId: id,
      data: {
        actorId,
        changes: {
          fullName: dto.fullName,
          role: dto.role,
          isActive: dto.isActive,
        },
      },
    });
    return adminView(user);
  }

  /** Soft delete: the account stays, signs out everywhere, and can't sign in. */
  async deactivate(id: string, actorId: string): Promise<void> {
    await this.update(id, { isActive: false }, actorId);
  }

  private async assertAnotherAdmin() {
    const admins = await this.prisma.user.count({
      where: { role: 'ADMIN', isActive: true },
    });
    if (admins <= 1) {
      throw new BadRequestException('Cannot remove the last active admin', {
        errorCode: 'LAST_ADMIN',
      });
    }
  }
}
