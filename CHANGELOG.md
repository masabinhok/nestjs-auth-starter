# Changelog

## 1.1.0 (2026-11-24)

Security release. Upgrading is strongly recommended.

### Security fixes

- **Refresh token rotation did not work.** Refresh tokens were stored as bcrypt
  hashes of JWTs. bcrypt only reads the first 72 bytes of its input, and those
  bytes are identical for every refresh token issued to the same user, so any
  unexpired refresh token of a user matched every stored session. A rotated or
  stolen token kept working, and logout could revoke the wrong session.
  Refresh tokens are now opaque random values stored as SHA-256 hashes, with
  single-use rotation and reuse detection: replaying a rotated token revokes
  the whole session.
- Internal error messages (including database errors) are no longer sent to
  clients. Prisma "not found" and "unique constraint" errors map to 404 and 409.
- CORS now honours `CORS_ORIGIN`. The option was misspelled, so the setting
  was ignored. `CORS_ORIGIN=*` is now rejected because auth uses credentials.
- Client IPs are no longer read from a raw `X-Forwarded-For` header. Set
  `TRUST_PROXY` when running behind a proxy.
- Changing a user's role or deactivating them now revokes their sessions.
- The last active admin can no longer be demoted, deactivated or deleted.
- Passwords longer than bcrypt's 72-byte limit are rejected at signup.
- Dependencies upgraded within NestJS 11 to clear known advisories
  (`@nestjs/core`, `jws`, `proxy-addr`, `path-to-regexp`, `multer`,
  `body-parser`, `zod` and others).

### Fixes

- Validation errors now return `400` with code `VALIDATION_FAILED` and the
  field errors in `error.details`, instead of "Internal server error".
- Health probes are no longer rate limited. Previously every route, including
  `/health/*`, was capped at 5 requests per minute.
- The global rate limit is 100 requests per minute; signup (3/min), login
  (5/min) and refresh (10/min) keep tighter limits.
- Emails are trimmed and lowercased, so `A@x.com` and `a@x.com` are one account.
- Login no longer applies the signup password policy.
- `GET /users/:id` returns 404 for unknown users and 400 for malformed IDs.
- Logout returns `200` and always clears cookies, even when the refresh token
  has expired.
- Cookie lifetimes now follow `JWT_ACCESS_EXPIRY` and `JWT_REFRESH_EXPIRY`.
- The `/health/live` response no longer includes the process ID.

### Upgrade notes

- Run `npm run prisma:migrate:deploy`. The migration discards existing refresh
  tokens, so every user has to log in again.
- The refresh cookie is now scoped to `/api/v1/auth`.
- The default `JWT_ACCESS_EXPIRY` is now `15m` (was `60m`).
- `POST /auth/logout` returns `200` instead of `201`.
- Validation error responses have a new shape (see above).

### Tests

- New e2e suite against a real PostgreSQL database covering the full auth
  flow and each fix above. Unit specs now run.

## 1.0.0 (2025-11-16)

Initial release.
