import request from 'supertest';
import {
  cookiesOf,
  createTestApp,
  createUser,
  login,
  type TestApp,
} from './utils.js';

// The browser's half of WebAuthn needs a real authenticator, so only the
// signature checks are stubbed. Everything around them (challenge binding
// and single use, credential storage, counters, sign-in) runs for real.
vi.mock('@simplewebauthn/server', async (original) => {
  const actual = await original<typeof import('@simplewebauthn/server')>();
  return {
    ...actual,
    verifyRegistrationResponse: vi.fn(
      async ({ response }: { response: { id: string } }) => ({
        verified: true,
        registrationInfo: {
          credential: {
            id: response.id,
            publicKey: new Uint8Array([1, 2, 3]),
            counter: 0,
            transports: ['internal'],
          },
          credentialDeviceType: 'multiDevice',
          credentialBackedUp: true,
        },
      }),
    ),
    verifyAuthenticationResponse: vi.fn(
      async ({ response }: { response: { valid?: boolean } }) => ({
        verified: response.valid !== false,
        authenticationInfo: { newCounter: 7 },
      }),
    ),
  };
});

describe('passkey register and sign-in flow', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());
  beforeEach(() => t.reset());

  async function register() {
    const user = await createUser(t);
    const { cookies } = await login(t);
    const options = await request(t.http)
      .post('/api/v1/auth/passkeys/registration/options')
      .set('Cookie', cookies)
      .expect(200);
    const registered = await request(t.http)
      .post('/api/v1/auth/passkeys/registration/verify')
      .set('Cookie', cookies)
      .send({
        challengeId: options.body.challengeId,
        response: { id: 'cred-1' },
        name: 'Laptop',
      })
      .expect(201);
    return { user, cookies, options, registered };
  }

  it('registers a passkey once per challenge', async () => {
    const { cookies, options, registered } = await register();
    expect(registered.body).toMatchObject({
      id: 'cred-1',
      name: 'Laptop',
      deviceType: 'multiDevice',
      backedUp: true,
    });
    await request(t.http)
      .post('/api/v1/auth/passkeys/registration/verify')
      .set('Cookie', cookies)
      .send({
        challengeId: options.body.challengeId,
        response: { id: 'cred-2' },
      })
      .expect(400);
    const list = await request(t.http)
      .get('/api/v1/auth/passkeys')
      .set('Cookie', cookies)
      .expect(200);
    expect(list.body).toHaveLength(1);
  });

  it('a challenge issued to one user cannot register for another', async () => {
    const { options } = await register();
    await createUser(t, { email: 'other@example.com' });
    const other = await login(t, 'other@example.com');
    const fresh = await request(t.http)
      .post('/api/v1/auth/passkeys/registration/options')
      .set('Cookie', (await login(t)).cookies);
    await request(t.http)
      .post('/api/v1/auth/passkeys/registration/verify')
      .set('Cookie', other.cookies)
      .send({ challengeId: fresh.body.challengeId, response: { id: 'stolen' } })
      .expect(400);
    expect(options.body.challengeId).not.toBe(fresh.body.challengeId);
  });

  it('signs in with the passkey and updates its counter', async () => {
    await register();
    const options = await request(t.http)
      .post('/api/v1/auth/passkeys/authentication/options')
      .expect(200);
    const res = await request(t.http)
      .post('/api/v1/auth/passkeys/authentication/verify')
      .send({
        challengeId: options.body.challengeId,
        response: { id: 'cred-1' },
      })
      .expect(200);
    expect(res.body).toMatchObject({
      user: { email: 'user@example.com' },
      mfaRequired: false,
    });
    await request(t.http)
      .get('/api/v1/auth/me')
      .set('Cookie', cookiesOf(res))
      .expect(200);

    const passkey = await t.prisma.passkey.findUniqueOrThrow({
      where: { id: 'cred-1' },
    });
    expect(passkey.counter).toBe(7n);
    expect(passkey.lastUsedAt).not.toBeNull();
  });

  it('refuses a failed assertion', async () => {
    await register();
    const options = await request(t.http).post(
      '/api/v1/auth/passkeys/authentication/options',
    );
    await request(t.http)
      .post('/api/v1/auth/passkeys/authentication/verify')
      .send({
        challengeId: options.body.challengeId,
        response: { id: 'cred-1', valid: false },
      })
      .expect(401);
  });

  it('removes a passkey', async () => {
    const { cookies } = await register();
    await request(t.http)
      .delete('/api/v1/auth/passkeys/cred-1')
      .set('Cookie', cookies)
      .expect(204);
    await request(t.http)
      .delete('/api/v1/auth/passkeys/cred-1')
      .set('Cookie', cookies)
      .expect(404);
  });
});
