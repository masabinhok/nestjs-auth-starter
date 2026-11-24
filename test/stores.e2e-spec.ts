import { authenticationStoreContract } from '@nestjs/authentication/testing';
import { PrismaService } from '../src/infra/database/prisma.service.js';
import { PrismaAuthenticationStore } from '../src/auth/stores/prisma-authentication.store.js';
import type { Env } from '../src/config/env.js';

/**
 * Runs @nestjs/authentication's own contract suite against the Prisma store,
 * including the concurrency cases, on a real Postgres.
 */

const prisma = new PrismaService({
  DATABASE_URL: process.env.DATABASE_URL,
} as Env);
const MAX_PENDING = 5;

// The suite invents user ids. The schema keeps its foreign keys to `users`,
// so in this test only, a trigger creates the placeholder users it needs.
const TABLES = [
  'sessions',
  'refresh_tokens',
  'totp_credentials',
  'recovery_codes',
  'email_tokens',
];

beforeAll(async () => {
  await prisma.$executeRawUnsafe(`
    CREATE OR REPLACE FUNCTION contract_placeholder_user() RETURNS trigger AS $$
    BEGIN
      INSERT INTO "users" ("id", "fullName", "email", "updatedAt")
      VALUES (NEW."userId", 'contract', NEW."userId" || '@contract.test', now())
      ON CONFLICT ("id") DO NOTHING;
      RETURN NEW;
    END $$ LANGUAGE plpgsql`);
  for (const table of TABLES) {
    await prisma.$executeRawUnsafe(
      `CREATE OR REPLACE TRIGGER contract_user BEFORE INSERT ON "${table}" FOR EACH ROW EXECUTE FUNCTION contract_placeholder_user()`,
    );
  }
});

afterAll(async () => {
  for (const table of TABLES) {
    await prisma.$executeRawUnsafe(
      `DROP TRIGGER IF EXISTS contract_user ON "${table}"`,
    );
  }
  await prisma.$executeRawUnsafe(
    'DROP FUNCTION IF EXISTS contract_placeholder_user()',
  );
  await prisma.user.deleteMany({
    where: { email: { endsWith: '@contract.test' } },
  });
  await prisma.$disconnect();
});

const cases = authenticationStoreContract(
  async () => {
    // The maxPending cases need the pending tables empty.
    await prisma.$executeRawUnsafe(
      'TRUNCATE "magic_links", "oidc_states", "email_tokens"',
    );
    const store = new PrismaAuthenticationStore(prisma);
    store.maxPending = MAX_PENDING;
    return {
      sessions: store,
      refreshTokens: store,
      mfa: store,
      emailTokens: store,
      magicLinks: store,
      oidcStates: store,
    };
  },
  { concurrent: true, maxPending: MAX_PENDING },
);

describe('PrismaAuthenticationStore contract', () => {
  for (const c of cases) {
    it(c.name, () => c.run());
  }
});
