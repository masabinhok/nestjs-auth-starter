import { Injectable, Optional } from '@nestjs/common';
import {
  AuthenticationStorage,
  type EmailTokenPurpose,
  type EmailTokenRecord,
  type EmailTokenStore,
  type MagicLinkRecord,
  type MagicLinkStore,
  type MfaStore,
  type OidcStateStore,
  type OidcTransaction,
  type RefreshTokenRecord,
  type RefreshTokenStore,
  type SessionRecord,
  type SessionStore,
  type TotpRecord,
} from '@nestjs/authentication';
import { PrismaService } from '../../infra/database/prisma.service.js';
import type {
  EmailToken,
  MagicLink,
  OidcState,
  Prisma,
  RefreshToken,
  Session,
} from '../../generated/prisma/client.js';
import '../auth.types.js';

/** Optional fields come back absent, never null (a rule of every contract). */
const opt = <T>(value: T | null): T | undefined => value ?? undefined;

/**
 * Postgres storage for all six @nestjs/authentication contracts. Each
 * method follows the rule in its interface's docs; the ones that guard
 * against races (single-use tokens, TOTP steps, recovery codes, attempt
 * counting) are single conditional statements, never a read then a write.
 * test/stores.e2e-spec.ts runs the package's contract suite against it.
 */
@Injectable()
export class PrismaAuthenticationStore
  implements
    SessionStore,
    RefreshTokenStore,
    MfaStore,
    EmailTokenStore,
    MagicLinkStore,
    OidcStateStore
{
  /**
   * Most pending magic links, OIDC logins and email tokens kept, per kind.
   * Anyone can request those, so the tables must stay bounded.
   */
  maxPending = 10_000;

  constructor(
    private readonly prisma: PrismaService,
    @Optional() storage?: AuthenticationStorage,
  ) {
    storage?.registerSource({
      sessions: this,
      refreshTokens: this,
      mfa: this,
      emailTokens: this,
      magicLinks: this,
      oidcStates: this,
    });
  }

  // ------------------------------------------------------------ sessions

  async getSession(id: string): Promise<SessionRecord | undefined> {
    const row = await this.prisma.session.findUnique({
      where: { id },
      include: { user: true },
    });
    return row
      ? { ...this.session(row), extra: { user: row.user } }
      : undefined;
  }

  async createSession(record: SessionRecord): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.session.deleteMany({
        where: { userId: record.userId, expiresAt: { lt: record.createdAt } },
      }),
      this.prisma.session.create({
        data: {
          id: record.id,
          userId: record.userId,
          createdAt: record.createdAt,
          expiresAt: record.expiresAt,
          lastActiveAt: record.lastActiveAt,
          mfa: record.mfa ?? null,
          metadata: (record.metadata as Prisma.InputJsonValue) ?? undefined,
        },
      }),
    ]);
  }

  async touchSession(id: string, lastActiveAt: Date): Promise<void> {
    await this.prisma.session.updateMany({
      where: { id, lastActiveAt: { lt: lastActiveAt } },
      data: { lastActiveAt },
    });
  }

  async deleteSession(id: string): Promise<boolean> {
    const { count } = await this.prisma.session.deleteMany({ where: { id } });
    return count > 0;
  }

  async listUserSessions(userId: string): Promise<SessionRecord[]> {
    const rows = await this.prisma.session.findMany({ where: { userId } });
    return rows.map((row) => this.session(row));
  }

  async deleteUserSessions(userId: string): Promise<void> {
    await this.prisma.session.deleteMany({ where: { userId } });
  }

  private session(row: Session): SessionRecord {
    return {
      id: row.id,
      userId: row.userId,
      createdAt: row.createdAt,
      expiresAt: row.expiresAt,
      lastActiveAt: row.lastActiveAt,
      mfa: opt(row.mfa) as SessionRecord['mfa'],
      metadata: opt(row.metadata) as Record<string, unknown> | undefined,
    };
  }

  // ------------------------------------------------------- refresh tokens

  async getRefreshToken(id: string): Promise<RefreshTokenRecord | undefined> {
    const row = await this.prisma.refreshToken.findUnique({ where: { id } });
    return row ? this.refreshToken(row) : undefined;
  }

  async saveRefreshToken(record: RefreshTokenRecord): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.refreshToken.deleteMany({
        where: {
          userId: record.userId,
          familyExpiresAt: { lt: record.createdAt },
        },
      }),
      this.prisma.refreshToken.create({
        data: {
          id: record.id,
          familyId: record.familyId,
          userId: record.userId,
          createdAt: record.createdAt,
          expiresAt: record.expiresAt,
          familyExpiresAt: record.familyExpiresAt,
          usedAt: record.usedAt ?? null,
          claims: (record.claims as Prisma.InputJsonValue) ?? undefined,
        },
      }),
    ]);
  }

  async markRefreshTokenUsed(id: string, at: Date): Promise<boolean> {
    const { count } = await this.prisma.refreshToken.updateMany({
      where: { id, usedAt: null },
      data: { usedAt: at },
    });
    return count === 1;
  }

  async revokeRefreshTokenFamily(familyId: string): Promise<void> {
    await this.prisma.refreshTokenFamilyRevocation.createMany({
      data: [{ familyId }],
      skipDuplicates: true,
    });
  }

  async isRefreshTokenFamilyRevoked(familyId: string): Promise<boolean> {
    const row = await this.prisma.refreshTokenFamilyRevocation.findUnique({
      where: { familyId },
    });
    return row !== null;
  }

  async revokeUserRefreshTokens(userId: string): Promise<void> {
    await this.prisma.$executeRaw`
      INSERT INTO "refresh_token_family_revocations" ("familyId")
      SELECT DISTINCT "familyId" FROM "refresh_tokens" WHERE "userId" = ${userId}
      ON CONFLICT ("familyId") DO NOTHING`;
  }

  private refreshToken(row: RefreshToken): RefreshTokenRecord {
    return {
      id: row.id,
      familyId: row.familyId,
      userId: row.userId,
      createdAt: row.createdAt,
      expiresAt: row.expiresAt,
      familyExpiresAt: row.familyExpiresAt,
      usedAt: opt(row.usedAt),
      claims: opt(row.claims) as Record<string, unknown> | undefined,
    };
  }

  // ----------------------------------------------------------------- mfa

  async getTotp(userId: string): Promise<TotpRecord | undefined> {
    const row = await this.prisma.totpCredential.findUnique({
      where: { userId },
    });
    if (!row) {
      return undefined;
    }
    return {
      secret: row.secret,
      confirmed: row.confirmed,
      pendingSecret: opt(row.pendingSecret),
      lastUsedStep:
        row.lastUsedStep === null ? undefined : Number(row.lastUsedStep),
    };
  }

  async saveTotp(userId: string, record: TotpRecord | null): Promise<void> {
    if (record === null) {
      await this.prisma.totpCredential.deleteMany({ where: { userId } });
      return;
    }
    // GREATEST keeps a step claimed concurrently from being reopened.
    await this.prisma.$executeRaw`
      INSERT INTO "totp_credentials" ("userId", "secret", "confirmed", "pendingSecret", "lastUsedStep")
      VALUES (${userId}, ${record.secret}, ${record.confirmed}, ${record.pendingSecret ?? null}, ${record.lastUsedStep ?? null})
      ON CONFLICT ("userId") DO UPDATE SET
        "secret" = EXCLUDED."secret",
        "confirmed" = EXCLUDED."confirmed",
        "pendingSecret" = EXCLUDED."pendingSecret",
        "lastUsedStep" = GREATEST("totp_credentials"."lastUsedStep", EXCLUDED."lastUsedStep")`;
  }

  async claimTotpStep(userId: string, step: number): Promise<boolean> {
    const count = await this.prisma.$executeRaw`
      UPDATE "totp_credentials" SET "lastUsedStep" = ${step}
      WHERE "userId" = ${userId}
        AND ("lastUsedStep" IS NULL OR "lastUsedStep" < ${step})`;
    return count === 1;
  }

  async saveRecoveryCodes(userId: string, hashes: string[]): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.recoveryCode.deleteMany({ where: { userId } }),
      this.prisma.recoveryCode.createMany({
        data: hashes.map((hash) => ({ userId, hash })),
        skipDuplicates: true,
      }),
    ]);
  }

  async consumeRecoveryCode(userId: string, hash: string): Promise<boolean> {
    const { count } = await this.prisma.recoveryCode.deleteMany({
      where: { userId, hash },
    });
    return count === 1;
  }

  countRecoveryCodes(userId: string): Promise<number> {
    return this.prisma.recoveryCode.count({ where: { userId } });
  }

  async recordMfaFailure(
    userId: string,
    windowMs: number,
    now: number,
  ): Promise<number> {
    const since = new Date(now - windowMs);
    await this.prisma.$transaction([
      this.prisma.mfaFailure.deleteMany({
        where: { userId, at: { lte: since } },
      }),
      this.prisma.mfaFailure.create({ data: { userId, at: new Date(now) } }),
    ]);
    return this.countMfaFailures(userId, windowMs, now);
  }

  countMfaFailures(
    userId: string,
    windowMs: number,
    now: number,
  ): Promise<number> {
    return this.prisma.mfaFailure.count({
      where: {
        userId,
        at: { gt: new Date(now - windowMs), lte: new Date(now) },
      },
    });
  }

  async clearMfaFailures(userId: string): Promise<void> {
    await this.prisma.mfaFailure.deleteMany({ where: { userId } });
  }

  // --------------------------------------------------------- email tokens

  async saveEmailToken(record: EmailTokenRecord): Promise<void> {
    await this.prisma.emailToken.create({
      data: {
        id: record.id,
        purpose: record.purpose,
        userId: record.userId,
        email: record.email,
        fingerprint: record.fingerprint ?? null,
        createdAt: record.createdAt,
        expiresAt: record.expiresAt,
      },
    });
    await this.prisma.emailToken.deleteMany({
      where: { expiresAt: { lte: record.createdAt } },
    });
    await this.prisma.$executeRaw`
      DELETE FROM "email_tokens" WHERE "id" IN (
        SELECT "id" FROM "email_tokens" ORDER BY "expiresAt" ASC
        LIMIT GREATEST((SELECT count(*) FROM "email_tokens") - ${this.maxPending}, 0)
      )`;
  }

  async consumeEmailToken(
    id: string,
    purpose: EmailTokenPurpose,
  ): Promise<EmailTokenRecord | undefined> {
    const rows = await this.prisma.$queryRaw<EmailToken[]>`
      DELETE FROM "email_tokens" WHERE "id" = ${id} AND "purpose" = ${purpose}
      RETURNING *`;
    const row = rows[0];
    if (!row) {
      return undefined;
    }
    return {
      id: row.id,
      purpose: row.purpose as EmailTokenPurpose,
      userId: row.userId,
      email: row.email,
      fingerprint: opt(row.fingerprint),
      createdAt: row.createdAt,
      expiresAt: row.expiresAt,
    };
  }

  async deleteUserEmailTokens(
    userId: string,
    purpose: EmailTokenPurpose,
  ): Promise<void> {
    await this.prisma.emailToken.deleteMany({ where: { userId, purpose } });
  }

  // ---------------------------------------------------------- magic links

  async saveMagicLink(record: MagicLinkRecord): Promise<void> {
    await this.prisma.magicLink.create({
      data: {
        id: record.id,
        email: record.email,
        createdAt: record.createdAt,
        expiresAt: record.expiresAt,
        redirectTo: record.redirectTo ?? null,
      },
    });
    await this.prisma.magicLink.deleteMany({
      where: { expiresAt: { lte: record.createdAt } },
    });
    await this.prisma.$executeRaw`
      DELETE FROM "magic_links" WHERE "id" IN (
        SELECT "id" FROM "magic_links" ORDER BY "expiresAt" ASC
        LIMIT GREATEST((SELECT count(*) FROM "magic_links") - ${this.maxPending}, 0)
      )`;
  }

  async consumeMagicLink(id: string): Promise<MagicLinkRecord | undefined> {
    const rows = await this.prisma.$queryRaw<MagicLink[]>`
      DELETE FROM "magic_links" WHERE "id" = ${id} RETURNING *`;
    const row = rows[0];
    return row
      ? {
          id: row.id,
          email: row.email,
          createdAt: row.createdAt,
          expiresAt: row.expiresAt,
          redirectTo: opt(row.redirectTo),
        }
      : undefined;
  }

  // ---------------------------------------------------------- oidc states

  async saveOidcState(transaction: OidcTransaction): Promise<void> {
    await this.prisma.oidcState.create({
      data: {
        state: transaction.state,
        provider: transaction.provider,
        nonce: transaction.nonce ?? null,
        codeVerifier: transaction.codeVerifier,
        redirectTo: transaction.redirectTo ?? null,
        createdAt: transaction.createdAt,
        expiresAt: transaction.expiresAt,
        linkUserId: transaction.link?.userId ?? null,
        linkSessionId: transaction.link?.sessionId ?? null,
      },
    });
    await this.prisma.oidcState.deleteMany({
      where: { expiresAt: { lte: transaction.createdAt } },
    });
    await this.prisma.$executeRaw`
      DELETE FROM "oidc_states" WHERE "state" IN (
        SELECT "state" FROM "oidc_states" ORDER BY "expiresAt" ASC
        LIMIT GREATEST((SELECT count(*) FROM "oidc_states") - ${this.maxPending}, 0)
      )`;
  }

  async consumeOidcState(state: string): Promise<OidcTransaction | undefined> {
    const rows = await this.prisma.$queryRaw<OidcState[]>`
      DELETE FROM "oidc_states" WHERE "state" = ${state} RETURNING *`;
    const row = rows[0];
    if (!row) {
      return undefined;
    }
    return {
      state: row.state,
      provider: row.provider,
      nonce: opt(row.nonce),
      codeVerifier: row.codeVerifier,
      redirectTo: opt(row.redirectTo),
      createdAt: row.createdAt,
      expiresAt: row.expiresAt,
      link:
        row.linkUserId && row.linkSessionId
          ? { userId: row.linkUserId, sessionId: row.linkSessionId }
          : undefined,
    };
  }
}
