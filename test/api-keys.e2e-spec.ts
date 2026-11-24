import request from 'supertest';
import { createTestApp, createUser, login, type TestApp } from './utils.js';

describe('API keys', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());
  beforeEach(() => t.reset());

  it('creates a key shown once, authenticates with it, and revokes it', async () => {
    await createUser(t);
    const { cookies } = await login(t);

    const created = await request(t.http)
      .post('/api/v1/auth/api-keys')
      .set('Cookie', cookies)
      .send({ name: 'CI', expiresInDays: 30 })
      .expect(201);
    expect(created.body.key).toMatch(/^nak_/);

    const row = await t.prisma.apiKey.findUniqueOrThrow({
      where: { id: created.body.id },
    });
    expect(row.hash).not.toBe(created.body.key);

    const bearer = `Bearer ${created.body.key}`;
    const me = await request(t.http)
      .get('/api/v1/auth/me')
      .set('Authorization', bearer)
      .expect(200);
    expect(me.body.email).toBe('user@example.com');

    const list = await request(t.http)
      .get('/api/v1/auth/api-keys')
      .set('Cookie', cookies)
      .expect(200);
    expect(list.body).toHaveLength(1);
    expect(list.body[0].key).toBeUndefined();

    await request(t.http)
      .delete(`/api/v1/auth/api-keys/${created.body.id}`)
      .set('Cookie', cookies)
      .expect(204);
    await request(t.http)
      .get('/api/v1/auth/me')
      .set('Authorization', bearer)
      .expect(401);
  });

  it('an API key cannot manage API keys', async () => {
    await createUser(t);
    const { cookies } = await login(t);
    const { body } = await request(t.http)
      .post('/api/v1/auth/api-keys')
      .set('Cookie', cookies)
      .send({ name: 'script' });
    await request(t.http)
      .post('/api/v1/auth/api-keys')
      .set('Authorization', `Bearer ${body.key}`)
      .send({ name: 'escalation' })
      .expect(401);
  });
});
