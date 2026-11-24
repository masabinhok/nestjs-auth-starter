import request from 'supertest';
import bcrypt from 'bcryptjs';
import {
  PASSWORD,
  SESSION_COOKIE,
  cookiesOf,
  createTestApp,
  createUser,
  lastMailedToken,
  login,
  rawCookie,
  type TestApp,
} from './utils.js';

describe('browser sign-in and account flows', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());
  beforeEach(() => t.reset());

  describe('signup and email verification', () => {
    it('creates the account and mails a verification link', async () => {
      const res = await request(t.http)
        .post('/api/v1/auth/signup')
        .send({
          email: ' New@Example.com ',
          password: PASSWORD,
          fullName: 'New User',
        })
        .expect(202);
      expect(res.body.message).toMatch(/inbox/);

      const user = await t.prisma.user.findUniqueOrThrow({
        where: { email: 'new@example.com' },
      });
      expect(user.emailVerifiedAt).toBeNull();
      expect(user.passwordHash).toMatch(/^\$scrypt\$/);

      const token = lastMailedToken(t, 'new@example.com');
      await request(t.http)
        .post('/api/v1/auth/email/verify')
        .send({ token })
        .expect(200);
      const verified = await t.prisma.user.findUniqueOrThrow({
        where: { id: user.id },
      });
      expect(verified.emailVerifiedAt).not.toBeNull();

      // Links work once.
      await request(t.http)
        .post('/api/v1/auth/email/verify')
        .send({ token })
        .expect(400);
    });

    it('answers the same for an existing email, and tells the owner instead', async () => {
      await createUser(t, { email: 'taken@example.com' });
      const res = await request(t.http)
        .post('/api/v1/auth/signup')
        .send({
          email: 'taken@example.com',
          password: PASSWORD,
          fullName: 'Someone',
        })
        .expect(202);
      expect(res.body.message).toMatch(/inbox/);
      expect(t.mail.outbox.at(-1)?.subject).toBe('You already have an account');
      expect(await t.prisma.user.count()).toBe(1);
    });

    it('returns validation errors as problem details', async () => {
      const res = await request(t.http)
        .post('/api/v1/auth/signup')
        .send({ email: 'nope', password: 'short', fullName: 'X', extra: true })
        .expect(400);
      expect(res.headers['content-type']).toMatch(/application\/problem\+json/);
      expect(res.body.errorCode).toBe('VALIDATION_FAILED');
      expect(Object.keys(res.body.errors)).toEqual(
        expect.arrayContaining(['email', 'password', 'fullName']),
      );
    });
  });

  describe('sessions', () => {
    it('signs in with an HttpOnly, Secure, __Host- cookie', async () => {
      await createUser(t);
      const res = await request(t.http)
        .post('/api/v1/auth/login')
        .send({ email: 'user@example.com', password: PASSWORD })
        .expect(200);
      expect(res.body).toMatchObject({
        user: { email: 'user@example.com' },
        mfaRequired: false,
      });
      const cookie = rawCookie(res, SESSION_COOKIE);
      expect(cookie).toMatch(/HttpOnly/i);
      expect(cookie).toMatch(/Secure/i);
      expect(cookie).toMatch(/Path=\//);

      const me = await request(t.http)
        .get('/api/v1/auth/me')
        .set('Cookie', cookiesOf(res))
        .expect(200);
      expect(me.body.email).toBe('user@example.com');
    });

    it('refuses wrong passwords and unknown emails with the same answer', async () => {
      await createUser(t);
      const wrong = await request(t.http)
        .post('/api/v1/auth/login')
        .send({ email: 'user@example.com', password: 'wrong password' })
        .expect(401);
      const unknown = await request(t.http)
        .post('/api/v1/auth/login')
        .send({ email: 'ghost@example.com', password: 'wrong password' })
        .expect(401);
      expect(wrong.body.errorCode).toBe('INVALID_CREDENTIALS');
      expect(unknown.body.detail).toBe(wrong.body.detail);
    });

    it('requires a session for protected routes', async () => {
      const res = await request(t.http).get('/api/v1/auth/me').expect(401);
      expect(res.body.errorCode).toBe('missing_credentials');
    });

    it('lists sessions and signs one device out', async () => {
      await createUser(t);
      const laptop = await login(t);
      const phone = await login(t);

      const list = await request(t.http)
        .get('/api/v1/auth/sessions')
        .set('Cookie', laptop.cookies)
        .expect(200);
      expect(list.body).toHaveLength(2);
      const other = list.body.find((s: { current: boolean }) => !s.current);

      await request(t.http)
        .delete(`/api/v1/auth/sessions/${other.id}`)
        .set('Cookie', laptop.cookies)
        .expect(204);
      await request(t.http)
        .get('/api/v1/auth/me')
        .set('Cookie', phone.cookies)
        .expect(401);
      await request(t.http)
        .get('/api/v1/auth/me')
        .set('Cookie', laptop.cookies)
        .expect(200);
    });

    it('logout ends the session; logout-all ends every session', async () => {
      await createUser(t);
      const a = await login(t);
      const b = await login(t);
      const c = await login(t);

      await request(t.http)
        .post('/api/v1/auth/logout')
        .set('Cookie', a.cookies)
        .expect(204);
      await request(t.http)
        .get('/api/v1/auth/me')
        .set('Cookie', a.cookies)
        .expect(401);
      await request(t.http)
        .get('/api/v1/auth/me')
        .set('Cookie', b.cookies)
        .expect(200);

      await request(t.http)
        .post('/api/v1/auth/logout-all')
        .set('Cookie', b.cookies)
        .expect(204);
      await request(t.http)
        .get('/api/v1/auth/me')
        .set('Cookie', c.cookies)
        .expect(401);
    });

    it('a deactivated user is signed out on the next request', async () => {
      const user = await createUser(t);
      const { cookies } = await login(t);
      await t.prisma.user.update({
        where: { id: user.id },
        data: { isActive: false },
      });
      await request(t.http)
        .get('/api/v1/auth/me')
        .set('Cookie', cookies)
        .expect(401);
    });
  });

  describe('passwords', () => {
    it('resets a forgotten password and signs out everywhere', async () => {
      await createUser(t);
      const before = await login(t);

      await request(t.http)
        .post('/api/v1/auth/password/forgot')
        .send({ email: 'user@example.com' })
        .expect(202);
      // The request returns before the mail is sent, so the answer can't leak timing.
      await vi.waitFor(() => lastMailedToken(t, 'user@example.com'));
      const token = lastMailedToken(t, 'user@example.com');

      await request(t.http)
        .post('/api/v1/auth/password/reset')
        .send({ token, password: 'a brand new password' })
        .expect(200);
      await request(t.http)
        .get('/api/v1/auth/me')
        .set('Cookie', before.cookies)
        .expect(401);
      await login(t, 'user@example.com', 'a brand new password');
      await request(t.http)
        .post('/api/v1/auth/password/reset')
        .send({ token, password: 'another password!' })
        .expect(400);
    });

    it('answers forgot-password the same for unknown emails', async () => {
      await request(t.http)
        .post('/api/v1/auth/password/forgot')
        .send({ email: 'ghost@example.com' })
        .expect(202);
      await new Promise((r) => setTimeout(r, 100));
      expect(t.mail.outbox).toHaveLength(0);
    });

    it('changing the password keeps this device and signs out the others', async () => {
      await createUser(t);
      const here = await login(t);
      const elsewhere = await login(t);

      const res = await request(t.http)
        .post('/api/v1/auth/password/change')
        .set('Cookie', here.cookies)
        .send({
          currentPassword: PASSWORD,
          newPassword: 'a different password',
        })
        .expect(200);
      await request(t.http)
        .get('/api/v1/auth/me')
        .set('Cookie', elsewhere.cookies)
        .expect(401);
      // This session was rotated to a new id.
      await request(t.http)
        .get('/api/v1/auth/me')
        .set('Cookie', cookiesOf(res))
        .expect(200);
      expect(t.mail.outbox.at(-1)?.subject).toBe('Your password was changed');
    });

    it('signs in v1 users with their bcrypt hash and upgrades it to scrypt', async () => {
      const user = await t.prisma.user.create({
        data: {
          email: 'legacy@example.com',
          fullName: 'Legacy',
          passwordHash: await bcrypt.hash('Legacy@123', 4),
        },
      });
      await login(t, 'legacy@example.com', 'Legacy@123');
      const upgraded = await t.prisma.user.findUniqueOrThrow({
        where: { id: user.id },
      });
      expect(upgraded.passwordHash).toMatch(/^\$scrypt\$/);
      await login(t, 'legacy@example.com', 'Legacy@123');
    });
  });

  describe('brute-force protection', () => {
    it('locks the account after repeated failures, even with the right password', async () => {
      await createUser(t);
      const attempt = (password: string) =>
        request(t.http)
          .post('/api/v1/auth/login')
          .send({ email: 'user@example.com', password });

      for (let i = 0; i < 5; i++) {
        expect((await attempt('wrong password')).status).toBe(401);
      }
      expect((await attempt(PASSWORD)).status).toBe(401);

      const events = await t.prisma.authEvent.findMany({
        where: { type: 'account-locked' },
      });
      expect(events).toHaveLength(1);
    });

    it('rate limits login per client', async () => {
      const statuses: number[] = [];
      for (let i = 0; i < 11; i++) {
        const res = await request(t.http)
          .post('/api/v1/auth/login')
          .send({ email: `x${i}@example.com`, password: 'whatever' });
        statuses.push(res.status);
      }
      expect(statuses.slice(0, 10).every((s) => s === 401)).toBe(true);
      expect(statuses[10]).toBe(429);
    });
  });

  describe('platform', () => {
    it('serves health probes without rate limits', async () => {
      for (let i = 0; i < 25; i++) {
        await request(t.http).get('/api/v1/health/live').expect(200);
      }
      const ready = await request(t.http).get('/api/v1/health').expect(200);
      expect(ready.body.info.database.status).toBe('up');
    });

    it('rejects cross-origin state changes (CSRF) but trusts the web app', async () => {
      await request(t.http)
        .post('/api/v1/auth/login')
        .set('Sec-Fetch-Site', 'cross-site')
        .set('Origin', 'https://evil.example')
        .send({ email: 'a@b.co', password: 'x' })
        .expect(403);
      await request(t.http)
        .post('/api/v1/auth/login')
        .set('Origin', 'http://localhost:3000')
        .send({ email: 'a@b.co', password: 'x' })
        .expect(401);
    });

    it('sends security headers and CORS for the configured origin', async () => {
      const res = await request(t.http)
        .get('/api/v1/health/live')
        .set('Origin', 'http://localhost:3000')
        .expect(200);
      expect(res.headers['access-control-allow-origin']).toBe(
        'http://localhost:3000',
      );
      expect(res.headers['access-control-allow-credentials']).toBe('true');
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['content-security-policy']).toBeDefined();
      expect(res.headers['x-powered-by']).toBeUndefined();
    });

    it('records an audit trail the user can read', async () => {
      await createUser(t);
      const { cookies } = await login(t);
      await vi.waitFor(async () => {
        const res = await request(t.http)
          .get('/api/v1/auth/activity')
          .set('Cookie', cookies);
        expect(res.body.map((e: { type: string }) => e.type)).toContain(
          'sign-in',
        );
      });
    });
  });
});
