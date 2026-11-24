import { execSync } from 'node:child_process';

// Applies pending migrations to the test database before the e2e run.
// Tests clean up their own rows, so no destructive reset is needed.
export default function globalSetup(): void {
  const url =
    process.env.TEST_DATABASE_URL ??
    'postgresql://postgres:postgres@localhost:55432/nest_auth_test';
  execSync('npx prisma migrate deploy', {
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: url },
  });
}
