import {
  github,
  google,
  type AuthenticationModuleOptions,
  type OidcProviderConfig,
} from '@nestjs/authentication';
import { featuresOf, type Env } from '../config/env.js';

export const API_PREFIX = 'api/v1';

/** Builds @nestjs/authentication's options from the validated environment. */
export function authenticationOptions(env: Env): AuthenticationModuleOptions {
  const features = featuresOf(env);
  const web = env.WEB_URL.replace(/\/$/, '');
  const api = env.APP_URL.replace(/\/$/, '');

  const providers: Record<string, OidcProviderConfig> = {};
  if (features.oidc.google) {
    providers.google = google({
      clientId: env.AUTH_GOOGLE_CLIENT_ID!,
      clientSecret: env.AUTH_GOOGLE_CLIENT_SECRET!,
    });
  }
  if (features.oidc.github) {
    providers.github = github({
      clientId: env.AUTH_GITHUB_CLIENT_ID!,
      clientSecret: env.AUTH_GITHUB_CLIENT_SECRET!,
    });
  }

  return {
    session: {
      absoluteTtl: env.AUTH_SESSION_TTL,
      idleTtl: env.AUTH_SESSION_IDLE_TTL,
      cookie: { secure: env.AUTH_COOKIE_SECURE },
      // A web app on another origin (CORS_ORIGIN) may use the cookie.
      trustedOrigins: env.CORS_ORIGIN,
      metadata: (request) => ({
        userAgent: String(request.headers['user-agent'] ?? '').slice(0, 255),
        ip: request.ip,
      }),
    },
    password: { logN: env.AUTH_SCRYPT_LOG_N },
    accessToken: {
      key: env.AUTH_JWT_SECRET,
      issuer: api,
      audience: api,
      ttl: env.AUTH_ACCESS_TOKEN_TTL,
      type: 'at+jwt',
    },
    refreshToken: { ttl: env.AUTH_REFRESH_TOKEN_TTL },
    emailVerification: { url: `${web}/verify-email` },
    passwordReset: { url: `${web}/reset-password` },
    ...(features.mfa && {
      mfa: {
        encryption: { keys: [env.AUTH_MFA_ENCRYPTION_KEY!] },
        issuer: env.AUTH_PASSKEY_RP_NAME,
      },
    }),
    ...(features.magicLink && {
      magicLink: {
        url: `${web}/magic-link`,
        cookie: { secure: env.AUTH_COOKIE_SECURE },
      },
    }),
    ...(Object.keys(providers).length > 0 && {
      oidc: {
        callbackUrl: `${api}/${API_PREFIX}/auth/oidc/:provider/callback`,
        providers,
        redirectAfterLogin: web,
        cookie: { secure: env.AUTH_COOKIE_SECURE },
      },
    }),
  };
}
