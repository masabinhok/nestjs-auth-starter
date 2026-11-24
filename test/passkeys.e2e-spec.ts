import request from 'supertest';
import { createTestApp, createUser, login, type TestApp } from './utils.js';

describe('passkeys', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());
  beforeEach(() => t.reset());

  it('issues registration options bound to the user, for the web app RP', async () => {
    await createUser(t);
    const { cookies } = await login(t);
    const res = await request(t.http)
      .post('/api/v1/auth/passkeys/registration/options')
      .set('Cookie', cookies)
      .expect(200);
    expect(res.body.options.rp).toEqual({
      id: 'localhost',
      name: expect.any(String),
    });
    expect(res.body.options.user.name).toBe('user@example.com');
    expect(res.body.challengeId).toEqual(expect.any(String));
  });

  it('issues public authentication options and refuses bogus assertions', async () => {
    const options = await request(t.http)
      .post('/api/v1/auth/passkeys/authentication/options')
      .expect(200);
    expect(options.body.options.rpId).toBe('localhost');

    const res = await request(t.http)
      .post('/api/v1/auth/passkeys/authentication/verify')
      .send({ challengeId: options.body.challengeId, response: { id: 'nope' } })
      .expect(401);
    expect(res.body.errorCode).toBe('PASSKEY_INVALID');

    // The challenge was consumed by the failed attempt.
    const row = await t.prisma.webauthnChallenge.findUnique({
      where: { id: options.body.challengeId },
    });
    expect(row).toBeNull();
  });

  it('registration requires a signed-in user', async () => {
    await request(t.http)
      .post('/api/v1/auth/passkeys/registration/options')
      .expect(401);
  });
});
