import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { MagicLinkService, Public } from '@nestjs/authentication';
import { Can } from '@nestjs/authorization';
import { Throttle } from '@nestjs/throttler';
import { ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../../infra/database/prisma.service.js';
import { toAuthUser } from '../auth.types.js';
import {
  MagicLinkRequestDto,
  MessageDto,
  SignInResponseDto,
  TokenDto,
} from '../dto/auth.dto.js';

/**
 * Passwordless sign-in for verified addresses. A link works once, and only
 * in the browser that asked for it (a cookie binds them).
 */
@ApiTags('magic-link')
@Public()
@Can.Anyone()
@Controller('auth/magic-link')
export class MagicLinkController {
  constructor(
    private readonly magicLinks: MagicLinkService,
    private readonly prisma: PrismaService,
  ) {}

  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @HttpCode(HttpStatus.ACCEPTED)
  @Post()
  async request(@Body() dto: MagicLinkRequestDto): Promise<MessageDto> {
    await this.magicLinks.create(dto.email, { redirectTo: dto.redirectTo });
    return {
      message: 'If this email can sign in with a link, one is on its way.',
    };
  }

  /** Called by the page the link opens, with `?token=…` from the URL. */
  @HttpCode(HttpStatus.OK)
  @Post('consume')
  async consume(
    @Body() dto: TokenDto,
  ): Promise<SignInResponseDto & { redirectTo?: string }> {
    const issued = await this.magicLinks.consume(dto.token);
    if (!issued) {
      throw new UnauthorizedException('This link is invalid or has expired', {
        errorCode: 'INVALID_TOKEN',
      });
    }
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: issued.session.userId },
    });
    return {
      user: toAuthUser(user),
      mfaRequired: issued.session.mfa === 'pending',
      redirectTo: issued.redirectTo,
    };
  }
}
