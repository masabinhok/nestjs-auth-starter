import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import { Throttle, SkipThrottle } from '@nestjs/throttler';
import { AuthService, ClientInfo, IssuedTokens } from './auth.service.js';
import { GetUser } from '../../common/decorators/get-user.decorator.js';
import { Public } from '../../common/decorators/public.decorator.js';
import { SignupDto } from './dtos/signup.dto.js';
import { LoginDto } from './dtos/login.dto.js';
import {
  ACCESS_TOKEN_COOKIE,
  REFRESH_TOKEN_COOKIE,
  REFRESH_TOKEN_COOKIE_PATH,
  authCookieOptions,
} from '../../common/constants/cookie.config.js';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly config: ConfigService,
  ) {}

  @Throttle({ default: { ttl: 60_000, limit: 3 } })
  @Public()
  @Post('/signup')
  async signup(@Body() signupDto: SignupDto) {
    return this.authService.signup(signupDto);
  }

  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  @Public()
  @Post('/login')
  async login(
    @Body() loginDto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const data = await this.authService.login(loginDto, this.clientInfo(req));
    this.setAuthCookies(res, data);
    return { user: data.user };
  }

  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @Public()
  @Post('/refresh')
  async refreshToken(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const presented = this.refreshCookie(req);
    if (!presented) {
      throw new UnauthorizedException('Refresh Token missing or malformed');
    }
    const tokens = await this.authService.refreshToken(
      presented,
      this.clientInfo(req),
    );
    this.setAuthCookies(res, tokens);
    return { message: 'Tokens refreshed successfully' };
  }

  /** Always clears cookies, even if the refresh token already expired. */
  @Public()
  @HttpCode(HttpStatus.OK)
  @Post('/logout')
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.authService.logout(this.refreshCookie(req));
    const base = authCookieOptions(this.isProduction, 0);
    res.clearCookie(ACCESS_TOKEN_COOKIE, { ...base, maxAge: undefined });
    res.clearCookie(REFRESH_TOKEN_COOKIE, {
      ...base,
      maxAge: undefined,
      path: REFRESH_TOKEN_COOKIE_PATH,
    });
    // Also clear the pre-1.1 refresh cookie, which was scoped to "/".
    res.clearCookie(REFRESH_TOKEN_COOKIE, { ...base, maxAge: undefined });
    return { message: 'Logged out successfully' };
  }

  @SkipThrottle()
  @Get('/me')
  async getMe(@GetUser('sub') userId: string) {
    return this.authService.getMe(userId);
  }

  private get isProduction(): boolean {
    return this.config.get<string>('NODE_ENV') === 'production';
  }

  private refreshCookie(req: Request): string | undefined {
    const value: unknown = req.cookies?.[REFRESH_TOKEN_COOKIE];
    return typeof value === 'string' && value.length > 0 ? value : undefined;
  }

  /** `req.ip` honours the TRUST_PROXY setting; raw headers are not trusted. */
  private clientInfo(req: Request): ClientInfo {
    return {
      deviceInfo: req.headers['user-agent'],
      ipAddress: req.ip,
    };
  }

  private setAuthCookies(res: Response, tokens: IssuedTokens): void {
    res.cookie(
      ACCESS_TOKEN_COOKIE,
      tokens.accessToken,
      authCookieOptions(this.isProduction, this.authService.accessTokenTtlMs),
    );
    res.cookie(
      REFRESH_TOKEN_COOKIE,
      tokens.refreshToken,
      authCookieOptions(
        this.isProduction,
        this.authService.refreshTokenTtlMs,
        REFRESH_TOKEN_COOKIE_PATH,
      ),
    );
  }
}
