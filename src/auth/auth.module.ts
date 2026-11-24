import {
  type DynamicModule,
  Module,
  type Provider,
  type Type,
} from '@nestjs/common';
import { featuresOf, type Env } from '../config/env.js';
import { PrismaAuthenticationStore } from './stores/prisma-authentication.store.js';
import { PasswordsService } from './passwords.service.js';
import { LoginService } from './login.service.js';
import { SessionAuthProvider } from './providers/session-auth.provider.js';
import { JwtAuthProvider } from './providers/jwt-auth.provider.js';
import { ApiKeyAuthProvider } from './providers/api-key-auth.provider.js';
import {
  EmailVerificationMailer,
  MagicLinkMailer,
  PasswordResetMailer,
} from './handlers/account.handlers.js';
import { OidcAccounts } from './handlers/oidc-accounts.resolver.js';
import { AuthController } from './controllers/auth.controller.js';
import { TokensController } from './controllers/tokens.controller.js';
import { MfaController } from './controllers/mfa.controller.js';
import { MagicLinkController } from './controllers/magic-link.controller.js';
import { OidcController } from './controllers/oidc.controller.js';
import { ApiKeysController } from './api-keys/api-keys.controller.js';
import { PasskeysController } from './passkeys/passkeys.controller.js';
import { PasskeysService } from './passkeys/passkeys.service.js';

/**
 * Everything this app adds on top of @nestjs/authentication: storage,
 * credential providers, feature handlers and routes. Features switched off
 * in the environment register neither their handlers nor their routes.
 */
@Module({})
export class AuthModule {
  static forRoot(env: Env): DynamicModule {
    const on = featuresOf(env);
    const oidc = on.oidc.google || on.oidc.github;
    const when = <T>(flag: boolean, items: T[]): T[] => (flag ? items : []);

    const controllers: Type[] = [
      AuthController,
      TokensController,
      ...when(on.mfa, [MfaController]),
      ...when(on.magicLink, [MagicLinkController]),
      ...when(oidc, [OidcController]),
      ...when(on.apiKeys, [ApiKeysController]),
      ...when(on.passkeys, [PasskeysController]),
    ];

    const providers: Provider[] = [
      PrismaAuthenticationStore,
      PasswordsService,
      LoginService,
      SessionAuthProvider,
      JwtAuthProvider,
      PasswordResetMailer,
      EmailVerificationMailer,
      ...when(on.magicLink, [MagicLinkMailer]),
      ...when(oidc, [OidcAccounts]),
      ...when(on.apiKeys, [ApiKeyAuthProvider]),
      ...when(on.passkeys, [PasskeysService]),
    ];

    return {
      module: AuthModule,
      controllers,
      providers,
      exports: [PasswordsService],
    };
  }
}
