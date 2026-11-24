/**
 * Writes openapi.json from the built app: `pnpm openapi`.
 *
 * Every optional feature is switched on with placeholder settings, so the
 * spec documents all routes. No database or real secrets are needed:
 * Prisma connects on first query, and nothing here queries.
 */
import { writeFileSync } from 'node:fs';

const placeholders: Record<string, string> = {
  DATABASE_URL: 'postgresql://openapi@localhost/openapi',
  AUTH_JWT_SECRET: 'openapi-export-placeholder-secret-000000',
  AUTH_MFA_ENCRYPTION_KEY: 'openapi-export-placeholder-key-0000000',
  AUTH_GOOGLE_CLIENT_ID: 'openapi',
  AUTH_GOOGLE_CLIENT_SECRET: 'openapi',
  AUTH_GITHUB_CLIENT_ID: 'openapi',
  AUTH_GITHUB_CLIENT_SECRET: 'openapi',
  MAIL_TRANSPORT: 'log',
  NODE_ENV: 'development',
};
for (const [key, value] of Object.entries(placeholders)) {
  process.env[key] = value;
}

// Imported after the environment is set: the app module reads it on load.
const { NestFactory } = await import('@nestjs/core');
const { AppModule } = await import('./app.module.js');
const { buildOpenApiDocument } = await import('./openapi.js');
const { API_PREFIX } = await import('./auth/auth.options.js');

const app = await NestFactory.create(AppModule, { logger: false });
app.setGlobalPrefix(API_PREFIX);
const document = buildOpenApiDocument(app);
writeFileSync('openapi.json', `${JSON.stringify(document, null, 2)}\n`);
await app.close();
console.log(`openapi.json: ${Object.keys(document.paths).length} paths`);
