import { Injectable } from '@nestjs/common';
import {
  AuthenticationRegistry,
  OidcAccountResolver,
  type OidcProfile,
  type OidcResolveContext,
} from '@nestjs/authentication';
import { PrismaService } from '../../infra/database/prisma.service.js';
import { AuditService } from '../../audit/audit.service.js';

/**
 * Maps a Google/GitHub identity to a local user:
 * 1. a known (provider, subject) signs in its user;
 * 2. a signed-in user connecting a provider (`?link=true`) gets it attached;
 * 3. an unknown identity with a provider-verified email signs in the local
 *    account with that email if the account verified it too, or creates one;
 * 4. anything else is refused, to rule out account pre-hijacking.
 */
@Injectable()
export class OidcAccounts extends OidcAccountResolver {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    registry: AuthenticationRegistry,
  ) {
    super();
    registry.registerHandler('oidc', this);
  }

  async resolveUser(
    profile: OidcProfile,
    _tokens: unknown,
    context: OidcResolveContext,
  ): Promise<{ id: string } | null> {
    const key = { provider: profile.provider, subject: profile.subject };
    const linked = await this.prisma.oAuthAccount.findUnique({
      where: { provider_subject: key },
      include: { user: true },
    });

    if (context.linkTo) {
      if (linked && linked.userId !== context.linkTo.id) {
        return null; // already belongs to someone else
      }
      if (!linked) {
        await this.link(context.linkTo.id, profile);
      }
      return context.linkTo;
    }

    if (linked) {
      return linked.user.isActive ? { id: linked.userId } : null;
    }

    const email = profile.email?.trim().toLowerCase();
    if (!email || !profile.emailVerified) {
      return null;
    }

    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) {
      if (!existing.isActive || !existing.emailVerifiedAt) {
        return null; // sign in with a password and link from the account instead
      }
      await this.link(existing.id, profile);
      return { id: existing.id };
    }

    const user = await this.prisma.user.create({
      data: {
        email,
        fullName: (profile.name ?? email.split('@')[0]).slice(0, 100),
        emailVerifiedAt: new Date(),
        oauthAccounts: { create: { ...key, email } },
      },
    });
    await this.audit.record({
      type: 'sign-up',
      userId: user.id,
      data: { method: `oidc:${profile.provider}` },
    });
    return { id: user.id };
  }

  private async link(userId: string, profile: OidcProfile) {
    await this.prisma.oAuthAccount.create({
      data: {
        provider: profile.provider,
        subject: profile.subject,
        email: profile.email,
        userId,
      },
    });
    await this.audit.record({
      type: 'oauth-account-linked',
      userId,
      data: { provider: profile.provider },
    });
  }
}
