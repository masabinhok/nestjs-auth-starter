import request from 'supertest';
import {
  PASSWORD,
  cookiesOf,
  createTestApp,
  createUser,
  login,
  totp,
  type TestApp,
} from './utils.js';

describe('two-factor authentication (TOTP)', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());
  beforeEach(() => t.reset());

  /** Enrolls MFA for user@example.com; returns the secret and recovery codes. */
  async function enroll() {
    await createUser(t);
    const { cookies } = await login(t);
    const enrollment = await request(t.http)
      .post('/api/v1/auth/mfa/enroll')
      .set('Cookie', cookies)
      .expect(200);
    expect(enrollment.body.uri).toMatch(/^otpauth:\/\/totp\//);
    const confirmed = await request(t.http)
      .post('/api/v1/auth/mfa/confirm')
      .set('Cookie', cookies)
      .send({ code: totp(enrollment.body.secret) })
      .expect(200);
    expect(confirmed.body.recoveryCodes).toHaveLength(10);
    return {
      secret: enrollment.body.secret as string,
      recoveryCodes: confirmed.body.recoveryCodes as string[],
      cookies: cookiesOf(confirmed).length ? cookiesOf(confirmed) : cookies,
    };
  }

  it('stores the TOTP secret encrypted', async () => {
    const { secret } = await enroll();
    const row = await t.prisma.totpCredential.findFirstOrThrow();
    expect(row.confirmed).toBe(true);
    expect(row.secret).not.toContain(secret);
  });

  it('a password alone gives a pending session until a code is verified', async () => {
    const { secret } = await enroll();
    const pending = await login(t);
    expect(pending.body.mfaRequired).toBe(true);
    await request(t.http)
      .get('/api/v1/auth/me')
      .set('Cookie', pending.cookies)
      .expect(401);

    await request(t.http)
      .post('/api/v1/auth/mfa/verify')
      .set('Cookie', pending.cookies)
      .send({ code: '000000' })
      .expect(401);

    // The step used to confirm can't be replayed; use the next one.
    const verified = await request(t.http)
      .post('/api/v1/auth/mfa/verify')
      .set('Cookie', pending.cookies)
      .send({ code: totp(secret, 1) })
      .expect(200);
    await request(t.http)
      .get('/api/v1/auth/me')
      .set('Cookie', cookiesOf(verified))
      .expect(200);
  });

  it('recovery codes work once', async () => {
    const { recoveryCodes } = await enroll();
    const pending = await login(t);
    const ok = await request(t.http)
      .post('/api/v1/auth/mfa/verify')
      .set('Cookie', pending.cookies)
      .send({ recoveryCode: recoveryCodes[0] })
      .expect(200);
    await request(t.http)
      .get('/api/v1/auth/me')
      .set('Cookie', cookiesOf(ok))
      .expect(200);

    const again = await login(t);
    await request(t.http)
      .post('/api/v1/auth/mfa/verify')
      .set('Cookie', again.cookies)
      .send({ recoveryCode: recoveryCodes[0] })
      .expect(401);
  });

  it('token clients must send the second factor', async () => {
    const { secret } = await enroll();
    const res = await request(t.http)
      .post('/api/v1/auth/token')
      .send({ email: 'user@example.com', password: PASSWORD })
      .expect(401);
    expect(res.body.errorCode).toBe('mfa_required');

    await request(t.http)
      .post('/api/v1/auth/token')
      .send({
        email: 'user@example.com',
        password: PASSWORD,
        code: totp(secret, 1),
      })
      .expect(200);
  });

  it('turning MFA off needs a session that passed MFA', async () => {
    const { secret } = await enroll();
    const pending = await login(t);
    const verified = await request(t.http)
      .post('/api/v1/auth/mfa/verify')
      .set('Cookie', pending.cookies)
      .send({ code: totp(secret, 1) })
      .expect(200);
    await request(t.http)
      .delete('/api/v1/auth/mfa')
      .set('Cookie', cookiesOf(verified))
      .expect(204);
    const status = await request(t.http)
      .get('/api/v1/auth/mfa')
      .set('Cookie', cookiesOf(verified));
    expect(status.body.enabled).toBe(false);
  });

  it('locks the second factor after repeated wrong codes', async () => {
    const { secret } = await enroll();
    const pending = await login(t);
    for (let i = 0; i < 5; i++) {
      await request(t.http)
        .post('/api/v1/auth/mfa/verify')
        .set('Cookie', pending.cookies)
        .send({ code: '000000' })
        .expect(401);
    }
    // Locked: even the right code is refused now.
    await request(t.http)
      .post('/api/v1/auth/mfa/verify')
      .set('Cookie', pending.cookies)
      .send({ code: totp(secret, 1) })
      .expect(401);
  });
});
