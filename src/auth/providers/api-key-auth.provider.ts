import { Injectable } from '@nestjs/common';
import {
  ApiKeyProvider,
  AuthenticationRegistry,
  type ApiKeyRecord,
} from '@nestjs/authentication';
import { InjectEnv } from '../../config/config.module.js';
import type { Env } from '../../config/env.js';
import { PrismaService } from '../../infra/database/prisma.service.js';
import { toAuthUser, type AuthUser } from '../auth.types.js';

const TOUCH_EVERY_MS = 60_000;

/** Scripts and integrations: `Authorization: Bearer nak_<id>_<secret>`. */
@Injectable()
export class ApiKeyAuthProvider extends ApiKeyProvider<AuthUser> {
  constructor(
    private readonly prisma: PrismaService,
    registry: AuthenticationRegistry,
    @InjectEnv() env: Env,
  ) {
    super({ prefix: env.AUTH_API_KEY_PREFIX });
    registry.registerProvider(this, { order: 2 });
  }

  protected async findKey(id: string): Promise<ApiKeyRecord<AuthUser> | null> {
    const key = await this.prisma.apiKey.findUnique({
      where: { id },
      include: { user: true },
    });
    if (!key || key.revokedAt || !key.user.isActive) {
      return null;
    }
    // Last use is informational; write it at most once a minute.
    if (
      !key.lastUsedAt ||
      Date.now() - key.lastUsedAt.getTime() > TOUCH_EVERY_MS
    ) {
      void this.prisma.apiKey
        .update({ where: { id }, data: { lastUsedAt: new Date() } })
        .catch(() => undefined);
    }
    return {
      hash: key.hash,
      user: toAuthUser(key.user),
      expiresAt: key.expiresAt,
    };
  }
}
