import { createHmac } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerStorage, ThrottlerStorageService } from '@nestjs/throttler';
import { PasswordHasher } from '@nestjs/authentication';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { loadEnv } from '../src/config/env.js';
import { PrismaService } from '../src/infra/database/prisma.service.js';
import { MailService } from '../src/infra/mail/mail.service.js';

export const PASSWORD = 'correct horse battery staple';
export const SESSION_COOKIE = '__Host-sid';

/** In-memory throttler storage that tests reset between cases. */
class ResettableThrottlerStorage implements ThrottlerStorage {
  private inner = new ThrottlerStorageService();
  increment(...args: Parameters<ThrottlerStorage['increment']>) {
    return this.inner.increment(...args);
  }
  reset() {
    this.inner = new ThrottlerStorageService();
  }
}

export interface TestApp {
  app: INestApplication;
  http: ReturnType<INestApplication['getHttpServer']>;
  prisma: PrismaService;
  mail: MailService;
  reset(): Promise<void>;
  close(): Promise<void>;
}

export async function createTestApp(): Promise<TestApp> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(ThrottlerStorage)
    .useValue(new ResettableThrottlerStorage())
    .compile();
  const app = moduleRef.createNestApplication({ logger: false });
  configureApp(app, loadEnv());
  await app.init();

  const prisma = app.get(PrismaService);
  const mail = app.get(MailService);
  return {
    app,
    http: app.getHttpServer(),
    prisma,
    mail,
    async reset() {
      app.get<ResettableThrottlerStorage>(ThrottlerStorage).reset();
      mail.outbox.length = 0;
      await prisma.$executeRawUnsafe(`TRUNCATE "users", "magic_links", "oidc_states",
        "mfa_failures", "refresh_token_family_revocations", "webauthn_challenges" CASCADE`);
    },
    close: () => app.close(),
  };
}

const hasher = new PasswordHasher({ logN: 10 });

export async function createUser(
  t: TestApp,
  overrides: {
    email?: string;
    role?: 'ADMIN' | 'USER';
    verified?: boolean;
    password?: string;
  } = {},
) {
  return t.prisma.user.create({
    data: {
      email: overrides.email ?? 'user@example.com',
      fullName: 'Test User',
      role: overrides.role ?? 'USER',
      passwordHash: await hasher.hash(overrides.password ?? PASSWORD),
      emailVerifiedAt: overrides.verified === false ? null : new Date(),
    },
  });
}

/** `name=value` pairs from Set-Cookie, ready to send back. */
export function cookiesOf(res: request.Response): string[] {
  const raw = res.headers['set-cookie'] as unknown as string[] | undefined;
  return (raw ?? [])
    .map((c) => c.split(';')[0])
    .filter((c) => !c.endsWith('='));
}

export function rawCookie(
  res: request.Response,
  name: string,
): string | undefined {
  const raw = res.headers['set-cookie'] as unknown as string[] | undefined;
  return raw?.find((c) => c.startsWith(`${name}=`));
}

/** Signs in with a password; returns the session cookie(s). */
export async function login(
  t: TestApp,
  email = 'user@example.com',
  password = PASSWORD,
) {
  const res = await request(t.http)
    .post('/api/v1/auth/login')
    .send({ email, password })
    .expect(200);
  return {
    cookies: cookiesOf(res),
    body: res.body as { mfaRequired: boolean },
  };
}

/** The `token` query parameter of the last link mailed to `to`. */
export function lastMailedToken(t: TestApp, to: string): string {
  const message = [...t.mail.outbox].reverse().find((m) => m.to === to);
  const match = message && /[?&]token=([^\s&"<]+)/.exec(message.text);
  if (!match) {
    throw new Error(`No link mailed to ${to}`);
  }
  return decodeURIComponent(match[1]);
}

// RFC 6238 TOTP (SHA-1, 6 digits, 30 s), for authenticator steps in tests.
function base32Decode(input: string): Buffer {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const c of input.replace(/=+$/, '').toUpperCase()) {
    bits += alphabet.indexOf(c).toString(2).padStart(5, '0');
  }
  const bytes = bits.match(/.{8}/g) ?? [];
  return Buffer.from(bytes.map((b) => parseInt(b, 2)));
}

export function totp(secret: string, stepOffset = 0): string {
  const step = Math.floor(Date.now() / 30_000) + stepOffset;
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const hmac = createHmac('sha1', base32Decode(secret))
    .update(counter)
    .digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  const code = (hmac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return code.toString().padStart(6, '0');
}
