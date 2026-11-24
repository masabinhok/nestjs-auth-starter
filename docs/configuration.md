# Configuration

Every setting is an environment variable, validated once at startup by the
schema in [`src/config/env.ts`](../src/config/env.ts). A missing or malformed
value stops the app with a message naming the variable. Locally, values come
from `.env` (copy [`.env.example`](../.env.example)); real environment
variables win over the file.

Durations accept `ms`, `s`, `m`, `h`, `d` and `w`: `15m`, `30d`.

## App

| Variable | Default | Description |
| --- | --- | --- |
| `NODE_ENV` | `development` | `development`, `production` or `test`. In production the app refuses to run auth on in-memory storage. |
| `PORT` | `8080` | HTTP port. |
| `LOG_LEVEL` | `info` | `fatal`, `error`, `warn`, `info`, `debug`, `trace` or `silent`. |
| `APP_URL` | `http://localhost:8080` | Public URL of this API. JWT issuer and audience; base of OAuth callback URLs. |
| `WEB_URL` | `http://localhost:3000` | Public URL of your web app. Emailed links open `/verify-email`, `/reset-password` and `/magic-link` there; passkeys use its hostname as the relying party. |
| `CORS_ORIGIN` | `http://localhost:3000` | Comma-separated origins allowed to call the API with cookies. Also trusted by the CSRF check. `*` is rejected. |
| `TRUST_PROXY` | unset | Express `trust proxy`. Set it behind a load balancer (`1` for one hop) so rate limits and session records see client IPs. |
| `API_DOCS` | `true` | Serve the API reference at `/docs` and the spec at `/openapi.json`. |

## Data

| Variable | Default | Description |
| --- | --- | --- |
| `DATABASE_URL` | required | PostgreSQL connection string. |
| `REDIS_URL` | unset | Shares rate-limit counters across instances. Without it, each instance counts on its own. |

## Auth

| Variable | Default | Description |
| --- | --- | --- |
| `AUTH_JWT_SECRET` | required | HS256 key for access tokens, 32+ characters. `openssl rand -base64 32`. |
| `AUTH_ACCESS_TOKEN_TTL` | `15m` | Access token lifetime. |
| `AUTH_REFRESH_TOKEN_TTL` | `30d` | Lifetime of one refresh token. A token family lives at most 90 days however often it rotates. |
| `AUTH_SESSION_TTL` | `7d` | Absolute browser session lifetime. |
| `AUTH_SESSION_IDLE_TTL` | `1d` | A session unused this long ends. |
| `AUTH_COOKIE_SECURE` | `true` | `Secure` cookies (browsers accept them on `http://localhost`). Turn off only for plain HTTP on another host. |
| `AUTH_LOGIN_MAX_ATTEMPTS` | `5` | Wrong passwords before the account locks. |
| `AUTH_LOGIN_LOCKOUT` | `15m` | How long a locked account refuses passwords. A password reset unlocks it. |
| `AUTH_SCRYPT_LOG_N` | `17` | scrypt cost (log2 N). 17 is the OWASP minimum; lower values are for tests. Raising it rehashes passwords at their next sign-in. |
| `AUTH_API_KEY_PREFIX` | `nak` | Start of every API key (`nak_<id>_<secret>`). Register it with secret scanners. |

### Features

A feature that is off registers neither its routes nor its handlers.

| Variable | Default | Description |
| --- | --- | --- |
| `AUTH_MFA` | `true` | TOTP two-factor authentication. |
| `AUTH_MFA_ENCRYPTION_KEY` | required with MFA | AES-256-GCM key for TOTP secrets at rest, 32+ characters. |
| `AUTH_MAGIC_LINK` | `true` | Passwordless sign-in links. |
| `AUTH_API_KEYS` | `true` | Personal API keys. |
| `AUTH_PASSKEYS` | `true` | Passkeys (WebAuthn). |
| `AUTH_PASSKEY_RP_NAME` | `NestJS Auth Starter` | Name shown by authenticators; also the TOTP issuer. |
| `AUTH_PASSKEY_RP_ID` | hostname of `WEB_URL` | WebAuthn relying party id. |
| `AUTH_GOOGLE_CLIENT_ID` | unset | With `AUTH_GOOGLE_CLIENT_SECRET`, enables Google sign-in. |
| `AUTH_GOOGLE_CLIENT_SECRET` | unset | |
| `AUTH_GITHUB_CLIENT_ID` | unset | With `AUTH_GITHUB_CLIENT_SECRET`, enables GitHub sign-in. |
| `AUTH_GITHUB_CLIENT_SECRET` | unset | |

OAuth callback URL to register with each provider:
`${APP_URL}/api/v1/auth/oidc/<google|github>/callback`.

## Mail

| Variable | Default | Description |
| --- | --- | --- |
| `MAIL_TRANSPORT` | `smtp` | `smtp`, `log` (print to the log) or `memory` (tests). |
| `SMTP_URL` | `smtp://localhost:1025` | Nodemailer connection URL. The default is Mailpit from docker compose. |
| `MAIL_FROM` | `NestJS Auth Starter <no-reply@example.com>` | Sender. |
