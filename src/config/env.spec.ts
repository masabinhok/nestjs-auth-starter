import { readFileSync } from 'node:fs';
import { EnvValidationError, envSchema, featuresOf, parseEnv } from './env.js';

const base = {
  DATABASE_URL: 'postgresql://localhost/db',
  AUTH_JWT_SECRET: 'x'.repeat(32),
  AUTH_MFA_ENCRYPTION_KEY: 'y'.repeat(32),
};

describe('env', () => {
  it('applies safe defaults', () => {
    const env = parseEnv(base);
    expect(env.AUTH_ACCESS_TOKEN_TTL).toBe('15m');
    expect(env.AUTH_COOKIE_SECURE).toBe(true);
    expect(env.AUTH_SCRYPT_LOG_N).toBe(17);
    expect(env.CORS_ORIGIN).toEqual(['http://localhost:3000']);
  });

  it('rejects short secrets and wildcard CORS', () => {
    expect(() => parseEnv({ ...base, AUTH_JWT_SECRET: 'short' })).toThrow(
      EnvValidationError,
    );
    expect(() => parseEnv({ ...base, CORS_ORIGIN: '*' })).toThrow(
      /CORS_ORIGIN/,
    );
  });

  it('requires an encryption key while MFA is on', () => {
    const { AUTH_MFA_ENCRYPTION_KEY: _, ...rest } = base;
    expect(() => parseEnv(rest)).toThrow(/AUTH_MFA_ENCRYPTION_KEY/);
    expect(() => parseEnv({ ...rest, AUTH_MFA: 'false' })).not.toThrow();
  });

  it('turns OAuth providers on only with both id and secret', () => {
    expect(() => parseEnv({ ...base, AUTH_GOOGLE_CLIENT_ID: 'id' })).toThrow(
      /GOOGLE/,
    );
    const env = parseEnv({
      ...base,
      AUTH_GOOGLE_CLIENT_ID: 'id',
      AUTH_GOOGLE_CLIENT_SECRET: 's',
    });
    expect(featuresOf(env).oidc).toEqual({ google: true, github: false });
  });

  it('parses comma-separated origins', () => {
    const env = parseEnv({
      ...base,
      CORS_ORIGIN: 'https://a.example, https://b.example',
    });
    expect(env.CORS_ORIGIN).toEqual(['https://a.example', 'https://b.example']);
  });
});

describe('documentation', () => {
  const keys = Object.keys(envSchema.shape);
  const docs = readFileSync('docs/configuration.md', 'utf8');
  const example = readFileSync('.env.example', 'utf8');

  it.each(keys)('%s is documented', (key) => {
    expect(docs).toContain(`\`${key}\``);
    expect(example).toContain(key);
  });
});
