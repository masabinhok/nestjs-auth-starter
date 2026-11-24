import type { OidcProfile } from '@nestjs/authentication';
import { OidcAccounts } from '../src/auth/handlers/oidc-accounts.resolver.js';
import type { AuditService } from '../src/audit/audit.service.js';
import { createTestApp, createUser, type TestApp } from './utils.js';

/** The account-linking rules, against the real database. */
describe('OidcAccounts resolver', () => {
  let t: TestApp;
  let resolver: OidcAccounts;

  beforeAll(async () => {
    t = await createTestApp();
    const audit = { record: async () => undefined } as unknown as AuditService;
    const registry = { registerHandler: () => undefined } as never;
    resolver = new OidcAccounts(t.prisma, audit, registry);
  });
  afterAll(() => t.close());
  beforeEach(() => t.reset());

  const profile = (over: Partial<OidcProfile> = {}): OidcProfile => ({
    provider: 'google',
    subject: 'sub-1',
    email: 'person@example.com',
    emailVerified: true,
    name: 'Person',
    claims: {},
    ...over,
  });

  it('creates a verified account for a new identity', async () => {
    const result = await resolver.resolveUser(profile(), {} as never, {});
    const user = await t.prisma.user.findUniqueOrThrow({
      where: { id: result!.id },
    });
    expect(user).toMatchObject({
      email: 'person@example.com',
      passwordHash: null,
    });
    expect(user.emailVerifiedAt).not.toBeNull();
    // Signing in again finds the same user by (provider, subject).
    expect(
      await resolver.resolveUser(
        profile({ email: 'changed@example.com' }),
        {} as never,
        {},
      ),
    ).toEqual(result);
  });

  it('refuses identities whose email the provider did not verify', async () => {
    expect(
      await resolver.resolveUser(
        profile({ emailVerified: false }),
        {} as never,
        {},
      ),
    ).toBeNull();
  });

  it('links to an existing account only if that account verified its email', async () => {
    const verified = await createUser(t, { email: 'person@example.com' });
    expect(await resolver.resolveUser(profile(), {} as never, {})).toEqual({
      id: verified.id,
    });

    await t.reset();
    // Someone registered the address first without proving it: refuse.
    await createUser(t, { email: 'person@example.com', verified: false });
    expect(await resolver.resolveUser(profile(), {} as never, {})).toBeNull();
  });

  it('connects a provider to the signed-in user, but never steals another account', async () => {
    const me = await createUser(t, { email: 'me@example.com' });
    const other = await createUser(t, { email: 'other@example.com' });
    expect(
      await resolver.resolveUser(profile(), {} as never, {
        linkTo: { id: me.id },
      }),
    ).toEqual({ id: me.id });
    expect(
      await resolver.resolveUser(profile(), {} as never, {
        linkTo: { id: other.id },
      }),
    ).toBeNull();
  });
});
