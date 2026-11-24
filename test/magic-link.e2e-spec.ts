import request from 'supertest';
import {
  cookiesOf,
  createTestApp,
  createUser,
  lastMailedToken,
  type TestApp,
} from './utils.js';

describe('magic links', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());
  beforeEach(() => t.reset());

  it('signs in the browser that asked for the link, once', async () => {
    await createUser(t);
    const asked = await request(t.http)
      .post('/api/v1/auth/magic-link')
      .send({ email: 'user@example.com', redirectTo: '/dashboard' })
      .expect(202);
    const browser = cookiesOf(asked);
    const token = lastMailedToken(t, 'user@example.com');

    const res = await request(t.http)
      .post('/api/v1/auth/magic-link/consume')
      .set('Cookie', browser)
      .send({ token })
      .expect(200);
    expect(res.body).toMatchObject({
      user: { email: 'user@example.com' },
      redirectTo: '/dashboard',
    });
    await request(t.http)
      .get('/api/v1/auth/me')
      .set('Cookie', cookiesOf(res))
      .expect(200);

    await request(t.http)
      .post('/api/v1/auth/magic-link/consume')
      .set('Cookie', browser)
      .send({ token })
      .expect(401);
  });

  it('refuses a link opened in another browser', async () => {
    await createUser(t);
    await request(t.http)
      .post('/api/v1/auth/magic-link')
      .send({ email: 'user@example.com' });
    const token = lastMailedToken(t, 'user@example.com');
    const res = await request(t.http)
      .post('/api/v1/auth/magic-link/consume')
      .send({ token })
      .expect(401);
    expect(res.body.errorCode).toBe('not_this_browser');
  });

  it('never signs in an unverified account (account pre-hijacking)', async () => {
    await createUser(t, { verified: false });
    const asked = await request(t.http)
      .post('/api/v1/auth/magic-link')
      .send({ email: 'user@example.com' })
      .expect(202);
    // The link is mailed either way, so the answer reveals nothing;
    // the account is refused when the link comes back.
    const token = lastMailedToken(t, 'user@example.com');
    await request(t.http)
      .post('/api/v1/auth/magic-link/consume')
      .set('Cookie', cookiesOf(asked))
      .send({ token })
      .expect(401);
  });
});
