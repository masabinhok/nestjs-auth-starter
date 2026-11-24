import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { SignInService } from '@nestjs/authentication';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type AuthenticatorTransport,
  type RegistrationResponseJSON,
} from '@simplewebauthn/server';
import { randomUUID } from 'node:crypto';
import { InjectEnv } from '../../config/config.module.js';
import type { Env } from '../../config/env.js';
import { PrismaService } from '../../infra/database/prisma.service.js';
import { AuditService } from '../../audit/audit.service.js';
import type { WebauthnChallenge } from '../../generated/prisma/client.js';
import type { AuthUser } from '../auth.types.js';

const CHALLENGE_TTL_MS = 5 * 60_000;

/**
 * Passkeys (WebAuthn) with @simplewebauthn/server: register one while signed
 * in, then sign in with it, passwordless. A passkey sign-in goes through
 * SignInService like any other, so it gets the same session cookie, session
 * fixation defence and (for users with TOTP) second-factor step.
 */
@Injectable()
export class PasskeysService {
  private readonly rpID: string;
  private readonly origin: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly signIn: SignInService,
    private readonly audit: AuditService,
    @InjectEnv() private readonly env: Env,
  ) {
    const web = new URL(env.WEB_URL);
    this.rpID = env.AUTH_PASSKEY_RP_ID ?? web.hostname;
    this.origin = web.origin;
  }

  list(userId: string) {
    return this.prisma.passkey.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        deviceType: true,
        backedUp: true,
        createdAt: true,
        lastUsedAt: true,
      },
    });
  }

  async registrationOptions(user: AuthUser) {
    const existing = await this.prisma.passkey.findMany({
      where: { userId: user.id },
    });
    const options = await generateRegistrationOptions({
      rpName: this.env.AUTH_PASSKEY_RP_NAME,
      rpID: this.rpID,
      userName: user.email,
      userDisplayName: user.fullName,
      userID: new TextEncoder().encode(user.id),
      attestationType: 'none',
      excludeCredentials: existing.map((p) => ({
        id: p.id,
        transports: p.transports as AuthenticatorTransport[],
      })),
      authenticatorSelection: {
        residentKey: 'required',
        userVerification: 'preferred',
      },
    });
    const challengeId = await this.saveChallenge(
      options.challenge,
      'registration',
      user.id,
    );
    return {
      challengeId,
      options: options as unknown as Record<string, unknown>,
    };
  }

  async register(
    user: AuthUser,
    challengeId: string,
    response: unknown,
    name?: string,
  ) {
    const challenge = await this.consumeChallenge(challengeId, 'registration');
    if (!challenge || challenge.userId !== user.id) {
      throw new BadRequestException('Unknown or expired challenge', {
        errorCode: 'INVALID_CHALLENGE',
      });
    }
    const result = await verifyRegistrationResponse({
      response: response as RegistrationResponseJSON,
      expectedChallenge: challenge.challenge,
      expectedOrigin: this.origin,
      expectedRPID: this.rpID,
    }).catch(() => ({ verified: false as const }));
    if (!result.verified) {
      throw new BadRequestException('Passkey could not be verified', {
        errorCode: 'PASSKEY_INVALID',
      });
    }
    const { credential, credentialDeviceType, credentialBackedUp } =
      result.registrationInfo;
    const passkey = await this.prisma.passkey.create({
      data: {
        id: credential.id,
        userId: user.id,
        name: name ?? 'Passkey',
        publicKey: Buffer.from(credential.publicKey),
        counter: BigInt(credential.counter),
        transports: credential.transports ?? [],
        deviceType: credentialDeviceType,
        backedUp: credentialBackedUp,
      },
      select: {
        id: true,
        name: true,
        deviceType: true,
        backedUp: true,
        createdAt: true,
        lastUsedAt: true,
      },
    });
    await this.audit.record({
      type: 'passkey-registered',
      userId: user.id,
      data: { passkeyId: passkey.id },
    });
    return passkey;
  }

  /** Discoverable credentials: the browser offers the user's passkeys itself. */
  async authenticationOptions() {
    const options = await generateAuthenticationOptions({
      rpID: this.rpID,
      userVerification: 'preferred',
    });
    const challengeId = await this.saveChallenge(
      options.challenge,
      'authentication',
    );
    return {
      challengeId,
      options: options as unknown as Record<string, unknown>,
    };
  }

  async authenticate(challengeId: string, response: unknown) {
    const challenge = await this.consumeChallenge(
      challengeId,
      'authentication',
    );
    const assertion = response as AuthenticationResponseJSON;
    const passkey = assertion?.id
      ? await this.prisma.passkey.findUnique({
          where: { id: assertion.id },
          include: { user: true },
        })
      : null;
    if (!challenge || !passkey || !passkey.user.isActive) {
      throw new UnauthorizedException('Passkey sign-in failed', {
        errorCode: 'PASSKEY_INVALID',
      });
    }
    const result = await verifyAuthenticationResponse({
      response: assertion,
      expectedChallenge: challenge.challenge,
      expectedOrigin: this.origin,
      expectedRPID: this.rpID,
      credential: {
        id: passkey.id,
        publicKey: new Uint8Array(passkey.publicKey),
        counter: Number(passkey.counter),
        transports: passkey.transports as AuthenticatorTransport[],
      },
    }).catch(() => ({ verified: false, authenticationInfo: undefined }));
    if (!result.verified || !result.authenticationInfo) {
      throw new UnauthorizedException('Passkey sign-in failed', {
        errorCode: 'PASSKEY_INVALID',
      });
    }
    await this.prisma.passkey.update({
      where: { id: passkey.id },
      data: {
        counter: BigInt(result.authenticationInfo.newCounter),
        lastUsedAt: new Date(),
      },
    });
    const issued = await this.signIn.signIn(passkey.userId, {
      method: 'passkey',
    });
    return {
      user: passkey.user,
      mfaRequired: issued.session.mfa === 'pending',
    };
  }

  async remove(userId: string, id: string) {
    const { count } = await this.prisma.passkey.deleteMany({
      where: { id, userId },
    });
    if (count === 0) {
      throw new NotFoundException('Passkey not found');
    }
    await this.audit.record({
      type: 'passkey-removed',
      userId,
      data: { passkeyId: id },
    });
  }

  private async saveChallenge(
    challenge: string,
    purpose: string,
    userId?: string,
  ) {
    const id = randomUUID();
    await this.prisma.webauthnChallenge.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    });
    await this.prisma.webauthnChallenge.create({
      data: {
        id,
        challenge,
        purpose,
        userId,
        expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS),
      },
    });
    return id;
  }

  /** One atomic DELETE … RETURNING: a challenge is answered once. */
  private async consumeChallenge(
    id: string,
    purpose: string,
  ): Promise<WebauthnChallenge | undefined> {
    const rows = await this.prisma.$queryRaw<WebauthnChallenge[]>`
      DELETE FROM "webauthn_challenges"
      WHERE "id" = ${id} AND "purpose" = ${purpose} AND "expiresAt" > now()
      RETURNING *`;
    return rows[0];
  }
}
