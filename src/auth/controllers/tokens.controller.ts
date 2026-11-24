import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { Public, TokenService } from '@nestjs/authentication';
import { Can } from '@nestjs/authorization';
import { Throttle } from '@nestjs/throttler';
import { ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { clientInfo } from '../../common/http.js';
import { LoginService } from '../login.service.js';
import {
  RefreshTokenDto,
  TokenPairDto,
  TokenRequestDto,
} from '../dto/auth.dto.js';

const ONE_MINUTE = 60_000;

/**
 * For clients that don't keep cookies (mobile apps, CLIs): a short-lived JWT
 * access token for `Authorization: Bearer`, and an opaque, single-use
 * refresh token. Replaying a used refresh token revokes its whole family.
 */
@ApiTags('tokens')
@Public()
@Can.Anyone()
@Controller('auth/token')
export class TokensController {
  constructor(
    private readonly login: LoginService,
    private readonly tokens: TokenService,
  ) {}

  /**
   * Exchanges credentials for tokens. Users with an authenticator send
   * `code` or `recoveryCode` too; without one the answer is 401 `mfa_required`.
   */
  @Throttle({ default: { limit: 10, ttl: ONE_MINUTE } })
  @HttpCode(HttpStatus.OK)
  @Post()
  async issue(
    @Body() dto: TokenRequestDto,
    @Req() req: Request,
  ): Promise<TokenPairDto> {
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
    const pair = await this.tokens.issue(user.id, {
      method: 'password',
      claims: { amr: ['pwd'] },
      secondFactor: { code: dto.code, recoveryCode: dto.recoveryCode },
    });
    return { ...pair, tokenType: 'Bearer' };
  }

  @Throttle({ default: { limit: 30, ttl: ONE_MINUTE } })
  @HttpCode(HttpStatus.OK)
  @Post('refresh')
  async refresh(@Body() dto: RefreshTokenDto): Promise<TokenPairDto> {
    const pair = await this.tokens.refresh(dto.refreshToken);
    return { ...pair, tokenType: 'Bearer' };
  }

  /** Signs this client out (RFC 7009: unknown tokens get the same answer). */
  @HttpCode(HttpStatus.NO_CONTENT)
  @Post('revoke')
  async revoke(@Body() dto: RefreshTokenDto): Promise<void> {
    await this.tokens.revoke(dto.refreshToken);
  }
}
