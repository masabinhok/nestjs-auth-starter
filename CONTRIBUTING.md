# Contributing

Thanks for helping. Bug reports, docs fixes and features are all welcome.
For anything bigger than a small fix, open an issue first so we can agree on
the approach.

## Setup

Requires Node 24.9+, pnpm (`corepack enable`), and Docker or Podman.

```bash
pnpm install
cp .env.example .env
docker compose up -d postgres redis mailpit
pnpm prisma:migrate:deploy
pnpm prisma:seed
pnpm start:dev
```

## Before you open a PR

```bash
pnpm format
pnpm lint
pnpm typecheck
pnpm test
pnpm db:test:up        # throwaway Postgres on :55432, once
pnpm test:e2e
pnpm openapi           # if you changed routes or DTOs; commit openapi.json
```

CI runs all of these on Node 24 and 26.

## Guidelines

- **Tests**: every behaviour change comes with a test. Auth flows are tested
  end to end against Postgres (`test/*.e2e-spec.ts`); pure logic gets unit
  tests next to the code (`*.spec.ts`).
- **Security-sensitive changes** (anything in `src/auth`, the store, cookies,
  tokens) need a sentence in the PR on what could go wrong and how the change
  prevents it.
- **Store changes** must keep `test/stores.e2e-spec.ts` (the package's
  contract suite) green.
- **Settings**: a new environment variable goes in `src/config/env.ts`,
  `.env.example` and `docs/configuration.md` (a test checks).
- **Migrations**: `pnpm prisma:migrate:create`, review the SQL, and make it
  safe for existing data.
- **PR titles** follow [Conventional Commits](https://www.conventionalcommits.org):
  `feat: …`, `fix: …`, `docs: …`, `feat!: …` for breaking changes. PRs are
  squash-merged, and the title drives the changelog and version.

## Good first issues

Look for the
[`good first issue`](../../issues?q=is%3Aopen+label%3A%22good+first+issue%22)
label. Ideas that fit well: a Drizzle store, a Microsoft Entra preset, email
templates with MJML, a Fastify variant, breached-password checks.
