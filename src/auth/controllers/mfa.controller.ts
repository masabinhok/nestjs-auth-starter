import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Post,
} from '@nestjs/common';
import {
  Authenticate,
  CurrentUser,
  MfaService,
  SignInService,
} from '@nestjs/authentication';
import { Can } from '@nestjs/authorization';
import { ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '../auth.types.js';
import {
  ConfirmMfaDto,
  MfaEnrollmentDto,
  RecoveryCodesDto,
} from '../dto/auth.dto.js';

/**
 * TOTP two-factor authentication. Secrets are encrypted at rest, codes work
 * once, and repeated wrong codes lock the second factor for a while.
 */
@ApiTags('mfa')
@Can.Anyone()
@Controller('auth/mfa')
export class MfaController {
  constructor(
    private readonly mfa: MfaService,
    private readonly signIn: SignInService,
  ) {}

  @Get()
  async status(@CurrentUser() user: AuthUser) {
    return {
      enabled: await this.mfa.isEnrolled(user.id),
      recoveryCodesRemaining: await this.mfa.remainingRecoveryCodes(user.id),
    };
  }

  /** Starts enrollment: show `uri` as a QR code, then confirm with a code. */
  @HttpCode(HttpStatus.OK)
  @Post('enroll')
  enroll(@CurrentUser() user: AuthUser): Promise<MfaEnrollmentDto> {
    return this.mfa.enroll(user.id, user.email);
  }

  /** Activates the authenticator and returns the recovery codes, once. */
  @HttpCode(HttpStatus.OK)
  @Post('confirm')
  async confirm(
    @CurrentUser() user: AuthUser,
    @Body() dto: ConfirmMfaDto,
  ): Promise<RecoveryCodesDto> {
    if (!(await this.signIn.confirmMfa(user.id, dto.code))) {
      throw new BadRequestException('Invalid code', {
        errorCode: 'INVALID_CODE',
      });
    }
    return { recoveryCodes: await this.mfa.generateRecoveryCodes(user.id) };
  }

  /** Replaces the recovery codes. Needs a session that passed MFA. */
  @Authenticate({ mfa: true })
  @HttpCode(HttpStatus.OK)
  @Post('recovery-codes')
  async regenerate(@CurrentUser() user: AuthUser): Promise<RecoveryCodesDto> {
    return { recoveryCodes: await this.mfa.generateRecoveryCodes(user.id) };
  }

  /** Turns MFA off. Needs a session that passed MFA. */
  @Authenticate({ mfa: true })
  @HttpCode(HttpStatus.NO_CONTENT)
  @Delete()
  async disable(@CurrentUser() user: AuthUser): Promise<void> {
    await this.mfa.disable(user.id);
  }
}
