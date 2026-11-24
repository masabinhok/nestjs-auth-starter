import request from 'supertest';
import {
  cookiesOf,
  createTestApp,
  createUser,
  login,
  type TestApp,
} from './utils.js';

describe('users and authorization policies', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());
  beforeEach(() => t.reset());

  async function asAdmin() {
    await createUser(t, { email: 'admin@example.com', role: 'ADMIN' });
    return (await login(t, 'admin@example.com')).cookies;
  }

  it('users manage their own profile', async () => {
    await createUser(t);
    const { cookies } = await login(t);
    const res = await request(t.http)
      .patch('/api/v1/users/me')
      .set('Cookie', cookies)
      .send({ fullName: 'Renamed' })
      .expect(200);
    expect(res.body.fullName).toBe('Renamed');
    await request(t.http)
      .patch('/api/v1/users/me')
      .set('Cookie', cookies)
      .send({ role: 'ADMIN' })
      .expect(400);
  });

  it('non-admins are forbidden from admin routes but may view themselves', async () => {
    const me = await createUser(t);
    const other = await createUser(t, { email: 'other@example.com' });
    const { cookies } = await login(t);
    await request(t.http)
      .get('/api/v1/users')
      .set('Cookie', cookies)
      .expect(403);
    await request(t.http)
      .get(`/api/v1/users/${other.id}`)
      .set('Cookie', cookies)
      .expect(403);
    await request(t.http)
      .get(`/api/v1/users/${me.id}`)
      .set('Cookie', cookies)
      .expect(200);
  });

  it('admins list, search and paginate users', async () => {
    const cookies = await asAdmin();
    await createUser(t, { email: 'alice@example.com' });
    await createUser(t, { email: 'bob@example.com' });
    const page = await request(t.http)
      .get('/api/v1/users?limit=2&page=1')
      .set('Cookie', cookies)
      .expect(200);
    expect(page.body.meta).toEqual({
      total: 3,
      page: 1,
      limit: 2,
      totalPages: 2,
    });
    const search = await request(t.http)
      .get('/api/v1/users?search=ALI')
      .set('Cookie', cookies);
    expect(search.body.data.map((u: { email: string }) => u.email)).toEqual([
      'alice@example.com',
    ]);
    expect(search.body.data[0].passwordHash).toBeUndefined();
  });

  it('deactivating a user signs them out everywhere', async () => {
    const cookies = await asAdmin();
    const user = await createUser(t);
    const session = await login(t);
    await request(t.http)
      .delete(`/api/v1/users/${user.id}`)
      .set('Cookie', cookies)
      .expect(204);
    await request(t.http)
      .get('/api/v1/auth/me')
      .set('Cookie', session.cookies)
      .expect(401);
    await request(t.http)
      .post('/api/v1/auth/login')
      .send({
        email: 'user@example.com',
        password: 'correct horse battery staple',
      })
      .expect(401);
  });

  it('refuses to remove the last admin', async () => {
    const cookies = await asAdmin();
    const me = await request(t.http)
      .get('/api/v1/auth/me')
      .set('Cookie', cookies);
    const res = await request(t.http)
      .patch(`/api/v1/users/${me.body.id}`)
      .set('Cookie', cookies)
      .send({ role: 'USER' })
      .expect(400);
    expect(res.body.errorCode).toBe('LAST_ADMIN');
  });

  it('returns 404 for unknown users and 400 for malformed ids', async () => {
    const cookies = await asAdmin();
    await request(t.http)
      .get('/api/v1/users/00000000-0000-4000-8000-000000000000')
      .set('Cookie', cookies)
      .expect(404);
    await request(t.http)
      .get('/api/v1/users/not-a-uuid')
      .set('Cookie', cookies)
      .expect(400);
  });

  it('records admin changes in the target user activity', async () => {
    const cookies = await asAdmin();
    const user = await createUser(t);
    const updated = await request(t.http)
      .patch(`/api/v1/users/${user.id}`)
      .set('Cookie', cookies)
      .send({ fullName: 'By Admin' })
      .expect(200);
    expect(updated.body).toMatchObject({
      fullName: 'By Admin',
      isActive: true,
      mfaEnabled: false,
    });
    const activity = await request(t.http)
      .get(`/api/v1/users/${user.id}/activity`)
      .set('Cookie', cookiesOf(updated).length ? cookiesOf(updated) : cookies)
      .expect(200);
    expect(activity.body[0].type).toBe('user-updated-by-admin');
  });
});
