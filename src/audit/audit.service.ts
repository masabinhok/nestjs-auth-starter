import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import {
  AuthenticationEvents,
  type AuthenticationEvent,
} from '@nestjs/authentication';
import type { Subscription } from 'rxjs';
import { PrismaService } from '../infra/database/prisma.service.js';
import type { Prisma } from '../generated/prisma/client.js';

/** Events this app records on top of the ones @nestjs/authentication emits. */
export type AppAuditEvent =
  | 'sign-up'
  | 'login-failed'
  | 'account-locked'
  | 'password-changed'
  | 'api-key-created'
  | 'api-key-revoked'
  | 'passkey-registered'
  | 'passkey-removed'
  | 'oauth-account-linked'
  | 'user-updated-by-admin';

export interface AuditEntry {
  type: AppAuditEvent | AuthenticationEvent['type'];
  userId?: string;
  ipAddress?: string;
  data?: Record<string, unknown>;
}

/**
 * Persists the audit trail. Every @nestjs/authentication event (sign-ins,
 * sign-outs, MFA changes, refresh token reuse, resets) is recorded by
 * subscribing to `AuthenticationEvents`; the app adds its own with `record()`.
 * Writing is best-effort: a failed insert is logged and never fails a request.
 */
@Injectable()
export class AuditService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AuditService.name);
  private subscription?: Subscription;

  constructor(
    private readonly prisma: PrismaService,
    private readonly authEvents: AuthenticationEvents,
  ) {}

  onModuleInit() {
    this.subscription = this.authEvents.events$.subscribe((event) => {
      const { type, ...rest } = event;
      const userId =
        'userId' in rest ? (rest.userId as string | undefined) : undefined;
      void this.record({ type, userId, data: rest as Record<string, unknown> });
    });
  }

  onModuleDestroy() {
    this.subscription?.unsubscribe();
  }

  async record(entry: AuditEntry): Promise<void> {
    try {
      await this.prisma.authEvent.create({
        data: {
          type: entry.type,
          userId: entry.userId,
          ipAddress: entry.ipAddress?.slice(0, 45),
          data: entry.data as Prisma.InputJsonValue | undefined,
        },
      });
    } catch (err) {
      this.logger.warn(
        { err, type: entry.type },
        'Could not record audit event',
      );
    }
  }

  async forUser(userId: string, limit = 50) {
    const rows = await this.prisma.authEvent.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    return rows.map((r) => ({
      id: r.id.toString(),
      type: r.type,
      ipAddress: r.ipAddress,
      data: r.data,
      createdAt: r.createdAt,
    }));
  }
}
