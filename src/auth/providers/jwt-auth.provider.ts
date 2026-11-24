import { Injectable } from '@nestjs/common';
import {
  AuthenticationRegistry,
  JwtBearerProvider,
  type JwtClaims,
} from '@nestjs/authentication';
import { PrismaService } from '../../infra/database/prisma.service.js';
import { toAuthUser, type AuthUser } from '../auth.types.js';

/**
 * Mobile apps and CLIs: `Authorization: Bearer <access token>`. The user is
 * loaded on every request, so a role change or deactivation applies at once
 * rather than when the token expires.
 */
@Injectable()
export class JwtAuthProvider extends JwtBearerProvider<AuthUser> {
  constructor(
    private readonly prisma: PrismaService,
    registry: AuthenticationRegistry,
  ) {
    super();
    registry.registerProvider(this, { order: 1 });
  }

  protected async validate(claims: JwtClaims): Promise<AuthUser | null> {
    if (!claims.sub) {
      return null;
    }
    const user = await this.prisma.user.findUnique({
      where: { id: claims.sub },
    });
    return user?.isActive ? toAuthUser(user) : null;
  }
}
