import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  Delete,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import {
  CurrentSession,
  CurrentUser,
  EmailVerificationService,
  PasswordResetService,
  Public,
  SessionService,
  SignInService,
  TokenService,
  type SessionRecord,
} from '@nestjs/authentication';
import { Can } from '@nestjs/authorization';
import { Throttle } from '@nestjs/throttler';
import { ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { PrismaService } from '../../infra/database/prisma.service.js';
import { MailService } from '../../infra/mail/mail.service.js';
import { templates } from '../../infra/mail/mail.templates.js';
import { AuditService } from '../../audit/audit.service.js';
import { InjectEnv } from '../../config/config.module.js';
import type { Env } from '../../config/env.js';
import { clientInfo } from '../../common/http.js';
import { toAuthUser, type AuthUser } from '../auth.types.js';
import { LoginService } from '../login.service.js';
import { PasswordsService } from '../passwords.service.js';
import {
  ChangePasswordDto,
  EmailDto,
  LoginDto,
  MessageDto,
  ResetPasswordDto,
  SecondFactorDto,
  SessionDto,
  SignInResponseDto,
  SignupDto,
  TokenDto,
  UserDto,
} from '../dto/auth.dto.js';

const ONE_MINUTE = 60_000;

/**
 * Browser sign-in with server-side sessions (`__Host-sid` cookie), plus
 * the account flows every app needs: email verification, password reset and
 * change, "your devices" and sign out everywhere.
 */
@ApiTags('auth')
@Can.Anyone()
@Controller('auth')
export class AuthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly login: LoginService,
    private readonly passwords: PasswordsService,
    private readonly signIn: SignInService,
    private readonly sessions: SessionService,
    private readonly tokens: TokenService,
    private readonly emailVerification: EmailVerificationService,
    private readonly passwordReset: PasswordResetService,
    private readonly mail: MailService,
    private readonly audit: AuditService,
    @InjectEnv() private readonly env: Env,
  ) {}

  /**
   * Creates an account and mails a verification link. The answer is the same
   * whether or not the email is registered (the owner of an existing account
   * gets an email instead), so this route can't be used to find accounts.
   */
  @Public()
  @Throttle({ default: { limit: 5, ttl: ONE_MINUTE } })
  @HttpCode(HttpStatus.ACCEPTED)
  @Post('signup')
  async signup(
    @Body() dto: SignupDto,
    @Req() req: Request,
  ): Promise<MessageDto> {
    const passwordHash = await this.passwords.hash(dto.password);
    const existing = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });

    if (existing) {
      await this.mail.send(
        templates.accountExists(existing.email, `${this.env.WEB_URL}/login`),
      );
    } else {
      const user = await this.prisma.user.create({
        data: { email: dto.email, fullName: dto.fullName, passwordHash },
      });
      await this.emailVerification.send(user);
      await this.audit.record({
        type: 'sign-up',
        userId: user.id,
        ipAddress: clientInfo(req).ip,
        data: { method: 'password' },
      });
    }
    return { message: 'Check your inbox to confirm your email address.' };
  }

  /**
   * Signs this browser in. With an authenticator enrolled, the session is
   * pending until `POST /auth/mfa/verify`.
   */
  @Public()
  @Throttle({ default: { limit: 10, ttl: ONE_MINUTE } })
  @HttpCode(HttpStatus.OK)
  @Post('login')
  async loginWithPassword(
    @Body() dto: LoginDto,
    @Req() req: Request,
  ): Promise<SignInResponseDto> {
    const user = await this.login.verifyCredentials(
      dto.email,
      dto.password,
      clientInfo(req),
    );
    if (!user) {
      throw new UnauthorizedException('Invalid email or password', {
        errorCode: 'INVALID_CREDENTIALS',
      });
    }
    const issued = await this.signIn.signIn(user.id, { method: 'password' });
    return {
      user: toAuthUser(user),
      mfaRequired: issued.session.mfa === 'pending',
    };
  }

  /** Completes a pending sign-in with a TOTP or recovery code. */
  @Public()
  @Throttle({ default: { limit: 10, ttl: ONE_MINUTE } })
  @HttpCode(HttpStatus.OK)
  @Post('mfa/verify')
  async verifyMfa(@Body() dto: SecondFactorDto): Promise<SignInResponseDto> {
    if (!dto.code && !dto.recoveryCode) {
      throw new BadRequestException('Send a code or a recovery code', {
        errorCode: 'CODE_REQUIRED',
      });
    }
    const issued = await this.signIn.completeMfa(dto);
    if (!issued) {
      throw new UnauthorizedException('Invalid code', {
        errorCode: 'INVALID_CODE',
      });
    }
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: issued.session.userId },
    });
    return { user: toAuthUser(user), mfaRequired: false };
  }

  /** Ends this browser's session and clears the cookie. */
  @Public()
  @HttpCode(HttpStatus.NO_CONTENT)
  @Post('logout')
  async logout(): Promise<void> {
    await this.signIn.signOut();
  }

  /** Ends every session and refresh-token family of the user. */
  @HttpCode(HttpStatus.NO_CONTENT)
  @Post('logout-all')
  async logoutEverywhere(@CurrentUser() user: AuthUser): Promise<void> {
    await this.signIn.signOutEverywhere(user.id);
  }

  @Get('me')
  me(@CurrentUser() user: AuthUser): UserDto {
    return user;
  }

  // --------------------------------------------------- email verification

  @Public()
  @HttpCode(HttpStatus.OK)
  @Post('email/verify')
  async verifyEmail(@Body() dto: TokenDto): Promise<MessageDto> {
    const verified = await this.emailVerification.verify(dto.token);
    if (!verified) {
      throw new BadRequestException('This link is invalid or has expired', {
        errorCode: 'INVALID_TOKEN',
      });
    }
    return { message: 'Email verified.' };
  }

  @Throttle({ default: { limit: 3, ttl: ONE_MINUTE } })
  @HttpCode(HttpStatus.ACCEPTED)
  @Post('email/resend')
  async resendVerification(@CurrentUser() user: AuthUser): Promise<MessageDto> {
    if (!user.emailVerified) {
      await this.emailVerification.send(user);
    }
    return {
      message: 'If your email is not verified yet, a new link is on its way.',
    };
  }

  // ------------------------------------------------------------ passwords

  /** Mails a reset link if the account exists. Same answer either way. */
  @Public()
  @Throttle({ default: { limit: 5, ttl: ONE_MINUTE } })
  @HttpCode(HttpStatus.ACCEPTED)
  @Post('password/forgot')
  forgotPassword(@Body() dto: EmailDto): MessageDto {
    this.passwordReset.request(dto.email);
    return {
      message: 'If an account uses this email, a reset link is on its way.',
    };
  }

  /** Sets a new password and signs the user out everywhere. */
  @Public()
  @Throttle({ default: { limit: 10, ttl: ONE_MINUTE } })
  @HttpCode(HttpStatus.OK)
  @Post('password/reset')
  async resetPassword(@Body() dto: ResetPasswordDto): Promise<MessageDto> {
    const result = await this.passwordReset.reset(dto.token, dto.password);
    if (!result) {
      throw new BadRequestException('This link is invalid or has expired', {
        errorCode: 'INVALID_TOKEN',
      });
    }
    return { message: 'Password updated. Sign in with your new password.' };
  }

  /** Changes the password; other devices are signed out, this one stays. */
  @Throttle({ default: { limit: 5, ttl: ONE_MINUTE } })
  @HttpCode(HttpStatus.OK)
  @Post('password/change')
  async changePassword(
    @CurrentUser() user: AuthUser,
    @CurrentSession() session: unknown,
    @Body() dto: ChangePasswordDto,
    @Req() req: Request,
  ): Promise<MessageDto> {
    const record = await this.prisma.user.findUniqueOrThrow({
      where: { id: user.id },
    });
    const check = await this.passwords.verify(
      dto.currentPassword,
      record.passwordHash,
    );
    if (!check.valid) {
      throw new BadRequestException('Current password is incorrect', {
        errorCode: 'INVALID_PASSWORD',
      });
    }
    await this.prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await this.passwords.hash(dto.newPassword) },
    });

    const current = isSessionRecord(session) ? session.id : undefined;
    await this.sessions.revokeAll(user.id, { except: current });
    await this.tokens.revokeAll(user.id);
    if (current) {
      await this.signIn.rotateSession();
    }

    await this.mail.send(templates.passwordChanged(user.email));
    await this.audit.record({
      type: 'password-changed',
      userId: user.id,
      ipAddress: clientInfo(req).ip,
    });
    return { message: 'Password changed. Other devices were signed out.' };
  }

  // -------------------------------------------------------------- devices

  /** Live sessions of the signed-in user ("where you're signed in"). */
  @Get('sessions')
  async listSessions(
    @CurrentUser() user: AuthUser,
    @CurrentSession() session: unknown,
  ): Promise<SessionDto[]> {
    const current = isSessionRecord(session) ? session.id : undefined;
    const list = await this.sessions.list(user.id);
    return list
      .sort((a, b) => b.lastActiveAt.getTime() - a.lastActiveAt.getTime())
      .map((s) => ({
        id: s.id,
        current: s.id === current,
        createdAt: s.createdAt,
        lastActiveAt: s.lastActiveAt,
        expiresAt: s.expiresAt,
        userAgent: s.metadata?.userAgent as string | undefined,
        ip: s.metadata?.ip as string | undefined,
        mfa: s.mfa,
      }));
  }

  /** Signs one device out. */
  @HttpCode(HttpStatus.NO_CONTENT)
  @Delete('sessions/:id')
  async revokeSession(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ): Promise<void> {
    if (!(await this.sessions.revoke(id, { userId: user.id }))) {
      throw new NotFoundException('Session not found');
    }
  }

  /** Recent security events on this account. */
  @Get('activity')
  activity(@CurrentUser() user: AuthUser) {
    return this.audit.forUser(user.id);
  }
}

function isSessionRecord(value: unknown): value is SessionRecord {
  return (
    typeof value === 'object' &&
    value !== null &&
    'lastActiveAt' in value &&
    'id' in value
  );
}
