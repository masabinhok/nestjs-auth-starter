import request from 'supertest';
import { PASSWORD, createTestApp, createUser, type TestApp } from './utils.js';

describe('token clients (mobile, CLI)', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());
  beforeEach(() => t.reset());

  const issue = () =>
    request(t.http)
      .post('/api/v1/auth/token')
      .send({ email: 'user@example.com', password: PASSWORD })
      .expect(200);

  it('issues a Bearer access token and a refresh token', async () => {
    await createUser(t);
    const { body } = await issue();
    expect(body).toMatchObject({ tokenType: 'Bearer', expiresIn: 900 });
    expect(body.refreshToken).toEqual(expect.any(String));

    const me = await request(t.http)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${body.accessToken}`)
      .expect(200);
    expect(me.body.email).toBe('user@example.com');
  });

  it('rejects a tampered access token with a WWW-Authenticate challenge', async () => {
    await createUser(t);
    const { body } = await issue();
    const res = await request(t.http)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${body.accessToken.slice(0, -2)}xx`)
      .expect(401);
    expect(res.headers['www-authenticate']).toMatch(/^Bearer/);
  });

  it('rotates refresh tokens and revokes the family when one is replayed', async () => {
    await createUser(t);
    const first = (await issue()).body;

    const second = (
      await request(t.http)
        .post('/api/v1/auth/token/refresh')
        .send({ refreshToken: first.refreshToken })
        .expect(200)
    ).body;
    expect(second.refreshToken).not.toBe(first.refreshToken);

    // Replaying the spent token is theft: the whole family dies.
    await request(t.http)
      .post('/api/v1/auth/token/refresh')
      .send({ refreshToken: first.refreshToken })
      .expect(401);
    await request(t.http)
      .post('/api/v1/auth/token/refresh')
      .send({ refreshToken: second.refreshToken })
      .expect(401);
  });

  it('revoke signs the client out; unknown tokens get the same answer', async () => {
    await createUser(t);
    const { body } = await issue();
    await request(t.http)
      .post('/api/v1/auth/token/revoke')
      .send({ refreshToken: body.refreshToken })
      .expect(204);
    await request(t.http)
      .post('/api/v1/auth/token/refresh')
      .send({ refreshToken: body.refreshToken })
      .expect(401);
    await request(t.http)
      .post('/api/v1/auth/token/revoke')
      .send({ refreshToken: 'not-a-token' })
      .expect(204);
  });

  it('applies role changes immediately, not when the token expires', async () => {
    const admin = await createUser(t, {
      email: 'admin@example.com',
      role: 'ADMIN',
    });
    await createUser(t, { email: 'admin2@example.com', role: 'ADMIN' });
    const { body } = await request(t.http)
      .post('/api/v1/auth/token')
      .send({ email: 'admin@example.com', password: PASSWORD })
      .expect(200);
    const auth = `Bearer ${body.accessToken}`;
    await request(t.http)
      .get('/api/v1/users')
      .set('Authorization', auth)
      .expect(200);

    await t.prisma.user.update({
      where: { id: admin.id },
      data: { role: 'USER' },
    });
    await request(t.http)
      .get('/api/v1/users')
      .set('Authorization', auth)
      .expect(403);
  });
});
