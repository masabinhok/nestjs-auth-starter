import { z } from 'zod';

/**
 * Every setting the app reads, validated once at startup. This is the only
 * place that reads `process.env`; everything else injects `Env` (see
 * ConfigModule) or calls `loadEnv()`.
 */

const duration = z
  .string()
  .regex(/^\d+(ms|s|m|h|d|w)$/, 'Use a duration like 15m, 12h, 30d')
  .transform((v) => v as `${number}${'ms' | 's' | 'm' | 'h' | 'd' | 'w'}`);

const bool = z
  .enum(['true', 'false', '1', '0'])
  .transform((v) => v === 'true' || v === '1');

const origin = z
  .string()
  .regex(/^https?:\/\/[^/\s]+$/, 'Use an origin like https://app.example.com');

const secret = (name: string) =>
  z
    .string()
    .min(
      32,
      `${name} must be at least 32 characters (openssl rand -base64 32)`,
    );

export const envSchema = z
  .object({
    NODE_ENV: z
      .enum(['development', 'production', 'test'])
      .default('development'),
    PORT: z.coerce.number().int().positive().default(8080),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),

    /** Public URL of this API, used as JWT issuer and for OAuth callbacks. */
    APP_URL: z.url().default('http://localhost:8080'),
    /** Public URL of the web app: the pages emailed links open. */
    WEB_URL: z.url().default('http://localhost:3000'),
    /** Comma-separated origins allowed to call the API with credentials. */
    CORS_ORIGIN: z
      .string()
      .default('http://localhost:3000')
      .transform((v) =>
        v
          .split(',')
          .map((o) => o.trim())
          .filter(Boolean),
      )
      .pipe(z.array(origin)),
    /** Express "trust proxy": e.g. 1 behind one load balancer. Unset trusts none. */
    TRUST_PROXY: z.string().optional(),

    DATABASE_URL: z.string().min(1),
    /** Enables shared rate-limit storage across instances. */
    REDIS_URL: z.string().optional(),

    AUTH_JWT_SECRET: secret('AUTH_JWT_SECRET'),
    AUTH_ACCESS_TOKEN_TTL: duration.default('15m'),
    AUTH_REFRESH_TOKEN_TTL: duration.default('30d'),
    AUTH_SESSION_TTL: duration.default('7d'),
    AUTH_SESSION_IDLE_TTL: duration.default('1d'),
    /** Session cookies are Secure by default; browsers accept that on http://localhost too. */
    AUTH_COOKIE_SECURE: bool.default(true),
    AUTH_LOGIN_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
    AUTH_LOGIN_LOCKOUT: duration.default('15m'),
    /** scrypt cost (log2 N). 17 is the OWASP minimum; lower it only in tests. */
    AUTH_SCRYPT_LOG_N: z.coerce.number().int().min(10).max(22).default(17),
    AUTH_API_KEY_PREFIX: z
      .string()
      .regex(/^[a-z][a-z0-9]{0,15}$/)
      .default('nak'),

    // Feature toggles. Disabled features register no routes.
    AUTH_MFA: bool.default(true),
    AUTH_MFA_ENCRYPTION_KEY: z.string().optional(),
    AUTH_MAGIC_LINK: bool.default(true),
    AUTH_API_KEYS: bool.default(true),
    AUTH_PASSKEYS: bool.default(true),
    AUTH_PASSKEY_RP_NAME: z.string().default('NestJS Auth Starter'),
    /** Defaults to the hostname of WEB_URL. */
    AUTH_PASSKEY_RP_ID: z.string().optional(),
    AUTH_GOOGLE_CLIENT_ID: z.string().optional(),
    AUTH_GOOGLE_CLIENT_SECRET: z.string().optional(),
    AUTH_GITHUB_CLIENT_ID: z.string().optional(),
    AUTH_GITHUB_CLIENT_SECRET: z.string().optional(),

    /** smtp (Mailpit in development), log (prints mail), memory (tests). */
    MAIL_TRANSPORT: z.enum(['smtp', 'log', 'memory']).default('smtp'),
    SMTP_URL: z.string().default('smtp://localhost:1025'),
    MAIL_FROM: z.string().default('NestJS Auth Starter <no-reply@example.com>'),

    /** Serve the API reference at /docs. */
    API_DOCS: bool.default(true),
  })
  .superRefine((env, ctx) => {
    if (env.AUTH_MFA && !env.AUTH_MFA_ENCRYPTION_KEY) {
      ctx.addIssue({
        code: 'custom',
        path: ['AUTH_MFA_ENCRYPTION_KEY'],
        message: 'Required when AUTH_MFA is on (openssl rand -base64 32)',
      });
    }
    if (
      env.AUTH_MFA_ENCRYPTION_KEY &&
      env.AUTH_MFA_ENCRYPTION_KEY.length < 32
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['AUTH_MFA_ENCRYPTION_KEY'],
        message: 'Must be at least 32 characters',
      });
    }
    for (const p of ['GOOGLE', 'GITHUB'] as const) {
      const id = env[`AUTH_${p}_CLIENT_ID`];
      const sec = env[`AUTH_${p}_CLIENT_SECRET`];
      if (Boolean(id) !== Boolean(sec)) {
        ctx.addIssue({
          code: 'custom',
          path: [`AUTH_${p}_CLIENT_SECRET`],
          message: `Set both AUTH_${p}_CLIENT_ID and AUTH_${p}_CLIENT_SECRET, or neither`,
        });
      }
    }
  });

export type Env = z.infer<typeof envSchema>;

/** Which optional auth features are on, derived from Env. */
export interface Features {
  mfa: boolean;
  magicLink: boolean;
  apiKeys: boolean;
  passkeys: boolean;
  oidc: { google: boolean; github: boolean };
}

export function featuresOf(env: Env): Features {
  return {
    mfa: env.AUTH_MFA,
    magicLink: env.AUTH_MAGIC_LINK,
    apiKeys: env.AUTH_API_KEYS,
    passkeys: env.AUTH_PASSKEYS,
    oidc: {
      google: Boolean(env.AUTH_GOOGLE_CLIENT_ID),
      github: Boolean(env.AUTH_GITHUB_CLIENT_ID),
    },
  };
}

export class EnvValidationError extends Error {
  constructor(error: z.ZodError) {
    super(`Invalid environment variables:\n${z.prettifyError(error)}`);
    this.name = 'EnvValidationError';
  }
}

export function parseEnv(source: Record<string, string | undefined>): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    throw new EnvValidationError(result.error);
  }
  return result.data;
}

let cached: Env | undefined;

/** Reads `.env` (if present) once, then validates `process.env`. */
export function loadEnv(): Env {
  if (!cached) {
    try {
      process.loadEnvFile();
    } catch {
      // No .env file: the real environment is used as is.
    }
    cached = parseEnv(process.env);
  }
  return cached;
}
