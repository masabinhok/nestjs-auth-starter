import { Injectable } from '@nestjs/common';
import { parseDuration } from '../common/duration.js';
import { InjectEnv } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import { PrismaService } from '../infra/database/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import type { ClientInfo } from '../common/http.js';
import type { User } from '../generated/prisma/client.js';
import { PasswordsService } from './passwords.service.js';

/**
 * Checks an email and password, with a per-account lockout on top of the
 * per-client rate limit: after AUTH_LOGIN_MAX_ATTEMPTS failures the account
 * refuses passwords for AUTH_LOGIN_LOCKOUT. Every refusal looks the same to
 * the caller (unknown email, wrong password, locked, deactivated) and takes
 * the same time, so responses don't reveal which accounts exist.
 */
@Injectable()
export class LoginService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordsService,
    private readonly audit: AuditService,
    @InjectEnv() private readonly env: Env,
  ) {}

  async verifyCredentials(
    email: string,
    password: string,
    client: ClientInfo = {},
  ): Promise<User | null> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    const locked = !!user?.lockedUntil && user.lockedUntil > new Date();

    // Checked even when the answer is already "no", so timing is the same.
    const check = await this.passwords.verify(
      password,
      locked ? null : (user?.passwordHash ?? null),
    );

    if (!user || locked || !user.isActive || !check.valid) {
      if (user && !locked) {
        await this.recordFailure(user, client);
      }
      await this.audit.record({
        type: 'login-failed',
        userId: user?.id,
        ipAddress: client.ip,
        data: {
          reason: !user
            ? 'unknown-email'
            : locked
              ? 'locked'
              : !user.isActive
                ? 'inactive'
                : 'bad-password',
        },
      });
      return null;
    }

    if (check.needsRehash || user.failedLoginAttempts > 0 || user.lockedUntil) {
      await this.prisma.user.update({
        where: { id: user.id },
        data: {
          failedLoginAttempts: 0,
          lockedUntil: null,
          ...(check.needsRehash && {
            passwordHash: await this.passwords.hash(password),
          }),
        },
      });
    }
    return user;
  }

  /** One atomic update: concurrent guesses can't outrun the counter. */
  private async recordFailure(user: User, client: ClientInfo): Promise<void> {
    const max = this.env.AUTH_LOGIN_MAX_ATTEMPTS;
    const until = new Date(
      Date.now() + parseDuration(this.env.AUTH_LOGIN_LOCKOUT),
    );
    const rows = await this.prisma.$queryRaw<{ locked: boolean }[]>`
      UPDATE "users" SET
        "failedLoginAttempts" = CASE WHEN "failedLoginAttempts" + 1 >= ${max} THEN 0 ELSE "failedLoginAttempts" + 1 END,
        "lockedUntil" = CASE WHEN "failedLoginAttempts" + 1 >= ${max} THEN ${until} ELSE "lockedUntil" END
      WHERE "id" = ${user.id}
      RETURNING ("lockedUntil" = ${until}) AS locked`;
    if (rows[0]?.locked) {
      await this.audit.record({
        type: 'account-locked',
        userId: user.id,
        ipAddress: client.ip,
        data: { until: until.toISOString() },
      });
    }
  }
}
