import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    root: './',
    include: ['test/**/*.e2e-spec.ts'],
    setupFiles: ['./test/setup-env.ts'],
    globalSetup: ['./test/global-setup.ts'],
    // Tests share one database, so run files one at a time.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/generated/**', 'src/main.ts', 'src/export-openapi.ts', '**/*.spec.ts'],
      reportsDirectory: './coverage/e2e',
      // Gates for CI. Raise them as coverage grows; don't lower them.
      thresholds: {
        lines: 88,
        functions: 90,
        branches: 75,
        'src/auth/**': { lines: 95, functions: 95, branches: 85 },
      },
    },
  },
});
