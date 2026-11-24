// Environment for e2e tests. Values here win over `.env`.
Object.assign(process.env, {
  NODE_ENV: 'test',
  DATABASE_URL:
    process.env.TEST_DATABASE_URL ??
    'postgresql://postgres:postgres@localhost:55432/nest_auth_test',
  AUTH_JWT_SECRET: 'test-jwt-secret-0123456789abcdefghijklmnop',
  AUTH_MFA_ENCRYPTION_KEY: 'test-mfa-key-0123456789abcdefghijklmnopq',
  APP_URL: 'http://localhost:8080',
  WEB_URL: 'http://localhost:3000',
  CORS_ORIGIN: 'http://localhost:3000',
  MAIL_TRANSPORT: 'memory',
  LOG_LEVEL: 'silent',
  API_DOCS: 'false',
  // Cheap scrypt in tests; production uses the OWASP minimum (17).
  AUTH_SCRYPT_LOG_N: '10',
});
