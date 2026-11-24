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
} from './utils';

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
      .expect(201);
    expect(cookieValue(cookiesOf(res), 'accessToken')).toBe('');
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

  // ---- Known v1 bugs. These assert correct behaviour and fail on v1. ----

  it.failing('C1: a rotated refresh token can no longer be used', async () => {
    const first = await signupAndLogin();
    // JWT iat has 1s resolution; wait so the rotated token differs.
    await new Promise((r) => setTimeout(r, 1100));
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

  it.failing(
    'C2: internal error messages are not leaked to clients',
    async () => {
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
    },
  );

  it.failing(
    'H1: CORS allows the configured origin with credentials',
    async () => {
      const res = await request(http)
        .get('/api/v1/health/live')
        .set('Origin', 'http://localhost:3000');
      expect(res.headers['access-control-allow-origin']).toBe(
        'http://localhost:3000',
      );
    },
  );

  it.failing(
    'H2: validation errors are returned with field details',
    async () => {
      const res = await request(http)
        .post('/api/v1/auth/signup')
        .send({ email: 'not-an-email', password: PASSWORD, fullName: 'X' })
        .expect(400);
      expect(res.body.error.message).not.toBe('Internal server error');
      expect(JSON.stringify(res.body.error)).toMatch(/email/);
    },
  );

  it.failing('H3: health probes are not rate limited', async () => {
    for (let i = 0; i < 20; i++) {
      await request(http).get('/api/v1/health/live').expect(200);
    }
  });
});
