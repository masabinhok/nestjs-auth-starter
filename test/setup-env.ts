// Environment for e2e tests. Values here take precedence over `.env`.
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  'postgresql://postgres:postgres@localhost:55432/nest_auth_test';
process.env.JWT_ACCESS_SECRET = 'test-access-secret-0123456789abcdefghijkl';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-0123456789abcdefghijk';
process.env.CORS_ORIGIN = 'http://localhost:3000';
process.env.LOG_LEVEL = 'fatal';
