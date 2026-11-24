import request from 'supertest';
import type { TestApp } from './utils.js';

// Vitest isolates modules per file, so this file boots the app with a
// different environment: optional features off, GitHub sign-in on.
Object.assign(process.env, {
  AUTH_MFA: 'false',
  AUTH_MAGIC_LINK: 'false',
  AUTH_API_KEYS: 'false',
  AUTH_PASSKEYS: 'false',
  AUTH_GITHUB_CLIENT_ID: 'test-client',
  AUTH_GITHUB_CLIENT_SECRET: 'test-secret',
});

describe('feature toggles', () => {
  let t: TestApp;
  beforeAll(async () => {
    const { createTestApp } = await import('./utils.js');
    t = await createTestApp();
  });
  afterAll(() => t.close());

  it.each([
    ['post', '/api/v1/auth/mfa/enroll'],
    ['post', '/api/v1/auth/magic-link'],
    ['get', '/api/v1/auth/api-keys'],
    ['post', '/api/v1/auth/passkeys/authentication/options'],
  ] as const)(
    '%s %s is not registered when its feature is off',
    async (method, path) => {
      await request(t.http)[method](path).expect(404);
    },
  );

  it('lists only the configured sign-in providers', async () => {
    const res = await request(t.http)
      .get('/api/v1/auth/oidc/providers')
      .expect(200);
    expect(res.body).toEqual(['github']);
  });

  it('starts a GitHub sign-in with PKCE, bound to this browser', async () => {
    const res = await request(t.http)
      .get('/api/v1/auth/oidc/github/login')
      .expect(302);
    const location = new URL(res.headers.location);
    expect(location.origin + location.pathname).toBe(
      'https://github.com/login/oauth/authorize',
    );
    expect(location.searchParams.get('client_id')).toBe('test-client');
    expect(location.searchParams.get('redirect_uri')).toBe(
      'http://localhost:8080/api/v1/auth/oidc/github/callback',
    );
    expect(location.searchParams.get('state')).toBeTruthy();
    const cookies = res.headers['set-cookie'] as unknown as string[];
    expect(cookies.some((c) => /oidc_tx=.*HttpOnly/i.test(c))).toBe(true);
  });

  it('refuses a callback that this browser did not start', async () => {
    const res = await request(t.http)
      .get('/api/v1/auth/oidc/github/callback?code=x&state=forged')
      .expect((r) => expect(r.status).toBeGreaterThanOrEqual(400));
    expect(res.status).toBeLessThan(500);
  });

  it('answers unknown providers with 404', async () => {
    await request(t.http).get('/api/v1/auth/oidc/myspace/login').expect(404);
  });
});
