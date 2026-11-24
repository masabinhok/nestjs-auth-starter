import { Injectable } from '@nestjs/common';
import {
  AuthenticationRegistry,
  EmailVerificationHandler,
  MagicLinkHandler,
  PasswordResetHandler,
  type EmailVerificationLink,
  type MagicLink,
  type MagicLinkAccount,
  type PasswordResetAccount,
  type PasswordResetLink,
} from '@nestjs/authentication';
import { PrismaService } from '../../infra/database/prisma.service.js';
import { MailService } from '../../infra/mail/mail.service.js';
import { templates } from '../../infra/mail/mail.templates.js';
import type { AuthUser } from '../auth.types.js';

/** "Forgot password": finds accounts, mails links, stores new hashes. */
@Injectable()
export class PasswordResetMailer extends PasswordResetHandler {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    registry: AuthenticationRegistry,
  ) {
    super();
    registry.registerHandler('passwordReset', this);
  }

  async findUser(email: string): Promise<PasswordResetAccount | null> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    return user?.isActive
      ? { id: user.id, email: user.email, passwordHash: user.passwordHash }
      : null;
  }

  async send(link: PasswordResetLink): Promise<void> {
    await this.mail.send(
      templates.resetPassword(link.email, link.url, link.expiresAt),
    );
  }

  async updatePassword(userId: string, passwordHash: string): Promise<void> {
    // A reset also lifts a lockout: the owner proved control of the inbox.
    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash, failedLoginAttempts: 0, lockedUntil: null },
    });
  }
}

@Injectable()
export class EmailVerificationMailer extends EmailVerificationHandler {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    registry: AuthenticationRegistry,
  ) {
    super();
    registry.registerHandler('emailVerification', this);
  }

  async send(link: EmailVerificationLink): Promise<void> {
    await this.mail.send(
      templates.verifyEmail(link.email, link.url, link.expiresAt),
    );
  }

  /** One conditional update: only while the address is still this one. */
  async markVerified(userId: string, email: string): Promise<boolean> {
    const { count } = await this.prisma.user.updateMany({
      where: { id: userId, email },
      data: { emailVerifiedAt: new Date() },
    });
    return count === 1;
  }

  isVerified(user: unknown): boolean {
    return (user as AuthUser | null)?.emailVerified === true;
  }
}

/**
 * Passwordless sign-in for existing accounts. Links go only to verified
 * addresses: otherwise whoever registered an address first (with a password
 * of their choosing) would keep access once the owner used a link.
 */
@Injectable()
export class MagicLinkMailer extends MagicLinkHandler {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    registry: AuthenticationRegistry,
  ) {
    super();
    registry.registerHandler('magicLink', this);
  }

  async send(link: MagicLink): Promise<void> {
    await this.mail.send(
      templates.magicLink(link.email, link.url, link.expiresAt),
    );
  }

  async resolveUser(email: string): Promise<MagicLinkAccount | null> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    return user?.isActive && user.emailVerifiedAt
      ? { id: user.id, email: user.email }
      : null;
  }
}
