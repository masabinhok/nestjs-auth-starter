import { Controller, Get, Param, Query, Redirect } from '@nestjs/common';
import { OidcService, Public } from '@nestjs/authentication';
import { Can } from '@nestjs/authorization';
import { ApiTags } from '@nestjs/swagger';
import { InjectEnv } from '../../config/config.module.js';
import { featuresOf, type Env } from '../../config/env.js';

/**
 * Sign in with Google or GitHub. Point a link at
 * `/api/v1/auth/oidc/google/login`; add `?link=true` while signed in to
 * connect the provider to the current account.
 */
@ApiTags('oidc')
@Public()
@Can.Anyone()
@Controller('auth/oidc')
export class OidcController {
  constructor(
    private readonly oidc: OidcService,
    @InjectEnv() private readonly env: Env,
  ) {}

  /** Providers that are configured, for rendering sign-in buttons. */
  @Get('providers')
  providers(): string[] {
    const { oidc } = featuresOf(this.env);
    return Object.entries(oidc)
      .filter(([, on]) => on)
      .map(([name]) => name);
  }

  @Get(':provider/login')
  @Redirect()
  login(
    @Param('provider') provider: string,
    @Query('redirectTo') redirectTo?: string,
    @Query('link') link?: string,
  ) {
    return this.oidc.start(provider, { redirectTo, link: link === 'true' });
  }

  @Get(':provider/callback')
  @Redirect()
  callback(
    @Param('provider') provider: string,
    @Query() query: Record<string, string>,
  ) {
    return this.oidc.finish(provider, query);
  }
}
