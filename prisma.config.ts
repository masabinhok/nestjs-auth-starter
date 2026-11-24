import { defineConfig } from 'prisma/config';

// Prisma 7 no longer reads .env on its own.
try {
  process.loadEnvFile();
} catch {
  // No .env file: rely on the real environment.
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    // Not needed for `prisma generate`, so a missing URL is not an error here.
    url: process.env.DATABASE_URL ?? '',
  },
});
