# Upgrading from v1 to v2

v2 rebuilds authentication on the official `@nestjs/authentication` and
`@nestjs/authorization` packages. Your users and their passwords carry over;
your clients need changes.

If you can't upgrade yet, use the `v1` branch: v1.1.0 fixed the security
issues found in v1.0.0 (see the [changelog](../CHANGELOG.md)).

## Requirements

| | v1 | v2 |
| --- | --- | --- |
| Node | 20+ | 24.9+ |
| Package manager | npm | pnpm (`corepack enable`) |
| Module format | CommonJS | ESM |
| NestJS | 11 | 12 |
| Prisma | 6 | 7 (with the `pg` driver adapter) |
| Tests | Jest | Vitest |
| Lint | ESLint | oxlint |

## Database

Run the migrations as usual:

```bash
pnpm prisma:migrate:deploy
```

The v2 migration (`20261124180000_v2_official_auth`):

- adds the tables the auth packages need, plus passkeys, API keys, OAuth
  accounts and the audit trail;
- keeps every user and password hash. v1 bcrypt hashes keep working, and each
  is replaced by scrypt the next time its user signs in;
- lowercases emails. If v1.0 let two accounts differ only in case
  (`A@x.com` and `a@x.com`), those are left unchanged so the migration can't
  fail. Find them with
  `SELECT lower(email), count(*) FROM users GROUP BY 1 HAVING count(*) > 1;`
  and merge or rename them, or those users can't sign in;
- discards v1 refresh tokens, so everyone signs in again once;
- leaves `emailVerifiedAt` empty: v1 never verified emails. Existing users can
  sign in, but magic links and linking a Google/GitHub account by email need a
  verified address. Users verify with `POST /auth/email/resend`, or mark trusted
  accounts verified in SQL.

## Environment

| v1 | v2 |
| --- | --- |
| `JWT_ACCESS_SECRET` | `AUTH_JWT_SECRET` |
| `JWT_REFRESH_SECRET` | removed (refresh tokens are opaque and stored hashed) |
| `JWT_ACCESS_EXPIRY` | `AUTH_ACCESS_TOKEN_TTL` |
| `JWT_REFRESH_EXPIRY` | `AUTH_REFRESH_TOKEN_TTL` |
| `CORS_ORIGIN` | unchanged |
| `TRUST_PROXY` | unchanged |
| | new: `APP_URL`, `WEB_URL`, `AUTH_MFA_ENCRYPTION_KEY`, mail settings, feature switches |

See [configuration.md](configuration.md) for everything.

## Clients

### Browsers

v1 set two JWT cookies (`accessToken`, `refreshToken`) and needed
`POST /auth/refresh`. v2 uses one server-side session cookie, `__Host-sid`.
There is nothing to refresh: drop the refresh logic.

| v1 | v2 |
| --- | --- |
| `POST /auth/signup` → `201 {user}` | `POST /auth/signup` → `202 {message}`; a verification email follows |
| `POST /auth/login` → `201 {user}` | `POST /auth/login` → `200 {user, mfaRequired}` |
| `POST /auth/refresh` | not needed |
| `POST /auth/logout` → `200` | `POST /auth/logout` → `204` |
| `GET /auth/me` | unchanged |

If `mfaRequired` is `true`, ask for a code and call `POST /auth/mfa/verify`.

### Mobile apps and other token clients

Use `POST /auth/token` for `{accessToken, refreshToken, expiresIn}`, send
`Authorization: Bearer <accessToken>`, and refresh with
`POST /auth/token/refresh`. Each refresh token works once: always store the
new one.

### Responses and errors

v1 wrapped every response in `{success, data, meta}`. v2 returns the resource
itself, and errors as RFC 9457 problem details:

```json
{ "type": "about:blank", "title": "Bad Request", "status": 400,
  "errorCode": "VALIDATION_FAILED", "errors": { "email": ["email must be an email"] } }
```

Branch on `errorCode`, not on `detail`.

### Users

| v1 | v2 |
| --- | --- |
| `GET /users/profile` | `GET /users/me` |
| `PATCH /users/profile` | `PATCH /users/me` |
| `GET /users?page&limit` → `{data, meta}` inside the envelope | `GET /users?page&limit&search` → `{data, meta}` |

## Code

- `@Roles(UserRole.ADMIN)` became a policy: `@Can(UserPolicy, 'manage')`.
  Every route needs `@Can(...)`, `@Can.Anyone()` or `@Public()`.
- `@GetUser('sub')` became `@CurrentUser()`, which returns the user, not JWT
  claims.
- `@Public()` now comes from `@nestjs/authentication`.
- `PrismaService` moved to `src/infra/database/`; the generated client to
  `src/generated/prisma`.
