import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import {
  PASSWORD,
  cookieValue,
  cookiesOf,
  createAdmin,
  createApp,
  resetDb,
  resetThrottle,
} from './utils.js';

describe('v1 auth flow (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<INestApplication['getHttpServer']>;

  beforeAll(async () => {
    app = await createApp();
    http = app.getHttpServer();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    resetThrottle(app);
    await resetDb(app);
  });

  async function signupAndLogin(email = 'user@example.com') {
    await request(http)
      .post('/api/v1/auth/signup')
      .send({ email, password: PASSWORD, fullName: 'Test User' })
      .expect(201);
    const res = await request(http)
      .post('/api/v1/auth/login')
      .send({ email, password: PASSWORD })
      .expect(201);
    return cookiesOf(res);
  }

  it('GET /health/live returns ok', async () => {
    const res = await request(http).get('/api/v1/health/live').expect(200);
    expect(res.body.data.status).toBe('ok');
  });

  it('signup returns the user inside the response envelope', async () => {
    const res = await request(http)
      .post('/api/v1/auth/signup')
      .send({ email: 'new@example.com', password: PASSWORD, fullName: 'New' })
      .expect(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.user).toMatchObject({
      email: 'new@example.com',
      role: 'USER',
    });
    expect(res.body.data.user.passwordHash).toBeUndefined();
  });

  it('login sets accessToken and refreshToken cookies', async () => {
    const cookies = await signupAndLogin();
    expect(cookieValue(cookies, 'accessToken')).toBeTruthy();
    expect(cookieValue(cookies, 'refreshToken')).toBeTruthy();
  });

  it('login rejects a wrong password with 401', async () => {
    await signupAndLogin();
    await request(http)
      .post('/api/v1/auth/login')
      .send({ email: 'user@example.com', password: 'Wr0ng!Password' })
      .expect(401);
  });

  it('GET /auth/me requires the access cookie', async () => {
    await request(http).get('/api/v1/auth/me').expect(401);
    const cookies = await signupAndLogin();
    const res = await request(http)
      .get('/api/v1/auth/me')
      .set('Cookie', cookies)
      .expect(200);
    expect(res.body.data.email).toBe('user@example.com');
  });

  it('POST /auth/refresh issues new cookies', async () => {
    const cookies = await signupAndLogin();
    const res = await request(http)
      .post('/api/v1/auth/refresh')
      .set('Cookie', cookies)
      .expect(201);
    expect(cookieValue(cookiesOf(res), 'refreshToken')).toBeTruthy();
  });

  it('POST /auth/logout clears cookies', async () => {
    const cookies = await signupAndLogin();
    const res = await request(http)
      .post('/api/v1/auth/logout')
      .set('Cookie', cookies)
      .expect(200);
    expect(cookieValue(cookiesOf(res), 'accessToken')).toBe('');
    // The session is gone server-side.
    await request(http)
      .post('/api/v1/auth/refresh')
      .set('Cookie', cookies)
      .expect(401);
  });

  it('rate limits login attempts per client', async () => {
    const attempt = () =>
      request(http)
        .post('/api/v1/auth/login')
        .send({ email: 'x@example.com', password: 'whatever' });
    for (let i = 0; i < 5; i++) {
      expect((await attempt()).status).toBe(401);
    }
    expect((await attempt()).status).toBe(429);
  });

  it('logout works without any cookies', async () => {
    await request(http).post('/api/v1/auth/logout').expect(200);
  });

  it('scopes the refresh cookie to the auth routes', async () => {
    await request(http)
      .post('/api/v1/auth/signup')
      .send({ email: 'p@example.com', password: PASSWORD, fullName: 'Pat' });
    const res = await request(http)
      .post('/api/v1/auth/login')
      .send({ email: 'p@example.com', password: PASSWORD });
    const raw = res.headers['set-cookie'] as unknown as string[];
    expect(raw.find((c) => c.startsWith('refreshToken='))).toMatch(
      /Path=\/api\/v1\/auth/,
    );
  });

  it('normalizes email case', async () => {
    await signupAndLogin('Mixed@Example.com');
    await request(http)
      .post('/api/v1/auth/login')
      .send({ email: 'mixed@example.com', password: PASSWORD })
      .expect(201);
  });

  it('rejects passwords longer than 72 bytes at signup', async () => {
    const res = await request(http)
      .post('/api/v1/auth/signup')
      .send({
        email: 'l@example.com',
        password: `Aa1!${'x'.repeat(80)}`,
        fullName: 'L',
      })
      .expect(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
  });

  it('replaying a rotated refresh token revokes the whole session', async () => {
    const first = await signupAndLogin();
    const rotated = await request(http)
      .post('/api/v1/auth/refresh')
      .set('Cookie', first)
      .expect(201);
    // Attacker replays the old token...
    await request(http)
      .post('/api/v1/auth/refresh')
      .set('Cookie', first)
      .expect(401);
    // ...which also kills the legitimate, newer token.
    await request(http)
      .post('/api/v1/auth/refresh')
      .set('Cookie', cookiesOf(rotated))
      .expect(401);
  });

  it('deactivating a user revokes their sessions', async () => {
    const userCookies = await signupAndLogin();
    await createAdmin(app);
    const admin = await request(http)
      .post('/api/v1/auth/login')
      .send({ email: 'admin@example.com', password: PASSWORD });
    const me = await request(http)
      .get('/api/v1/auth/me')
      .set('Cookie', userCookies);
    await request(http)
      .patch(`/api/v1/users/${me.body.data.id}`)
      .set('Cookie', cookiesOf(admin))
      .send({ isActive: false })
      .expect(200);
    await request(http)
      .post('/api/v1/auth/refresh')
      .set('Cookie', userCookies)
      .expect(401);
  });

  it('refuses to deactivate the last admin', async () => {
    await createAdmin(app);
    const admin = await request(http)
      .post('/api/v1/auth/login')
      .send({ email: 'admin@example.com', password: PASSWORD });
    const me = await request(http)
      .get('/api/v1/auth/me')
      .set('Cookie', cookiesOf(admin));
    await request(http)
      .patch(`/api/v1/users/${me.body.data.id}`)
      .set('Cookie', cookiesOf(admin))
      .send({ isActive: false })
      .expect(400);
  });

  it('returns 404 for an unknown user id', async () => {
    await createAdmin(app);
    const admin = await request(http)
      .post('/api/v1/auth/login')
      .send({ email: 'admin@example.com', password: PASSWORD });
    await request(http)
      .get('/api/v1/users/00000000-0000-0000-0000-000000000000')
      .set('Cookie', cookiesOf(admin))
      .expect(404);
  });

  it('non-admins get 403 on admin routes, admins get a paginated list', async () => {
    const userCookies = await signupAndLogin();
    await request(http)
      .get('/api/v1/users')
      .set('Cookie', userCookies)
      .expect(403);

    await createAdmin(app);
    const adminRes = await request(http)
      .post('/api/v1/auth/login')
      .send({ email: 'admin@example.com', password: PASSWORD })
      .expect(201);
    const res = await request(http)
      .get('/api/v1/users?page=1&limit=10')
      .set('Cookie', cookiesOf(adminRes))
      .expect(200);
    expect(res.body.data.meta.total).toBe(2);
  });

  // ---- Regression tests for bugs fixed in v1.1.0. ----

  it('C1: a rotated refresh token can no longer be used', async () => {
    const first = await signupAndLogin();
    await request(http)
      .post('/api/v1/auth/refresh')
      .set('Cookie', first)
      .expect(201);
    // Replaying the original refresh token must be rejected.
    await request(http)
      .post('/api/v1/auth/refresh')
      .set('Cookie', first)
      .expect(401);
  });

  it('C2: internal error messages are not leaked to clients', async () => {
    await createAdmin(app);
    const login = await request(http)
      .post('/api/v1/auth/login')
      .send({ email: 'admin@example.com', password: PASSWORD });
    const res = await request(http)
      .patch('/api/v1/users/00000000-0000-0000-0000-000000000000')
      .set('Cookie', cookiesOf(login))
      .send({ fullName: 'Nobody' });
    expect(res.status).toBe(404);
    expect(JSON.stringify(res.body)).not.toMatch(/prisma/i);
  });

  it('H1: CORS allows the configured origin with credentials', async () => {
    const res = await request(http)
      .get('/api/v1/health/live')
      .set('Origin', 'http://localhost:3000');
    expect(res.headers['access-control-allow-origin']).toBe(
      'http://localhost:3000',
    );
  });

  it('H2: validation errors are returned with field details', async () => {
    const res = await request(http)
      .post('/api/v1/auth/signup')
      .send({ email: 'not-an-email', password: PASSWORD, fullName: 'X' })
      .expect(400);
    expect(res.body.error.message).not.toBe('Internal server error');
    expect(JSON.stringify(res.body.error)).toMatch(/email/);
  });

  it('H3: health probes are not rate limited', async () => {
    for (let i = 0; i < 20; i++) {
      await request(http).get('/api/v1/health/live').expect(200);
    }
  });
});
