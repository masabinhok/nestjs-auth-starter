# Security model

What this starter defends against, how, and where the limits are. Report
vulnerabilities privately: see [SECURITY.md](../SECURITY.md).

## Credentials

| Threat | Defence | Where |
| --- | --- | --- |
| Offline cracking after a database leak | scrypt, N=2^17, r=8 (OWASP minimum), parameters in the hash so they can be raised; old hashes are upgraded at sign-in | `@nestjs/authentication` `PasswordHasher`, `passwords.service.ts` |
| Online guessing | Per-account lockout (5 failures → 15 min, configurable) and per-client rate limits | `login.service.ts`, `@Throttle` on sign-in routes |
| Account enumeration | Login, sign-up, password reset and magic links answer the same, in the same time, for unknown emails; unknown emails are checked against a dummy hash | `login.service.ts`, `auth.controller.ts` |
| Weak passwords | 8 to 128 characters (NIST SP 800-63B); no composition rules | `auth.dto.ts` |

To also block breached passwords, check new passwords against
[Have I Been Pwned's range API](https://haveibeenpwned.com/API/v3#PwnedPasswords)
in `SignupDto`, `ResetPasswordDto` and `ChangePasswordDto` handlers.

## Sessions and tokens

| Threat | Defence |
| --- | --- |
| Session theft through XSS | Session cookie is `HttpOnly`, `Secure`, `SameSite=Lax`, `__Host-` prefixed; only a SHA-256 of the token is stored |
| Session fixation | Every sign-in replaces the browser's previous session; MFA completion and password change rotate the session id |
| CSRF | Fetch Metadata check on every state-changing request (`app.enableCsrfProtection()`), plus the session provider ignoring the cookie on cross-origin writes; only `CORS_ORIGIN` is trusted |
| Login CSRF | Sign-in from another origin is refused; magic links and OAuth logins are bound to the browser that started them |
| Stolen refresh token | Single-use tokens in families; replaying a spent token revokes the family, so both thief and victim must sign in again (OAuth 2.0 Security BCP §4.14.2) |
| Lingering access after a role change or ban | Every request reloads the user: sessions, JWTs and API keys stop working at once. Admin role changes and deactivation also end all sessions and token families |
| Long-lived credentials | Access tokens 15 min; sessions 7 days absolute, 1 day idle; refresh families at most 90 days; API keys may expire |

## Second factors

- TOTP secrets are encrypted at rest with AES-256-GCM (`AUTH_MFA_ENCRYPTION_KEY`).
  Rotate the key by prepending a new one in `auth.options.ts`.
- Each code works once, and after 5 wrong codes in 15 minutes every code is
  refused. Attempts are counted before they are checked, so parallel guesses
  can't outrun the limit.
- Recovery codes are stored hashed and work once.
- Turning MFA off or regenerating recovery codes needs a session that passed
  MFA (`@Authenticate({ mfa: true })`).
- Passkeys: challenges are single-use, expire after 5 minutes, and are bound
  to the user who requested a registration. Signature counters are stored.

## Accounts

- Sign-in links (magic links) only work for verified email addresses, and
  OAuth identities are linked by email only when both the provider and the
  account verified it. Both rules prevent account pre-hijacking.
- Password reset links are single use, expire after an hour, and stop
  working if the password changes by any route.
- The last active admin can't be demoted, deactivated or deleted.

## Transport and platform

- Security headers (helmet's defaults) via `app.useSecurityHeaders()`.
  Only `/docs` relaxes the Content-Security-Policy, to load the API
  reference bundle.
- CORS: explicit origins with credentials; `*` is rejected at startup.
- `TRUST_PROXY` must match your proxy setup; raw `X-Forwarded-For` headers
  are never read.
- Errors never include internal messages or stack traces; they are logged
  with a request id that the response also carries.
- Logs redact `Authorization`, `Cookie` and `Set-Cookie` headers.
- The production Docker image runs as a non-root user with production
  dependencies only.
- `pnpm` runs dependency install scripts only for an explicit allow-list
  (`pnpm-workspace.yaml`).

## Audit trail

`auth_events` records sign-ins, sign-outs, failed logins, lockouts, refresh
token reuse, MFA and recovery code changes, password resets and changes,
email verification, API key and passkey changes, OAuth linking, and admin
changes to users. Users see theirs at `GET /auth/activity`; admins at
`GET /users/:id/activity`.

## Known limits

- Rate limits without `REDIS_URL` are per instance.
- Access tokens already issued remain valid until they expire, but every
  request reloads the user, so a deactivated user is refused at once.
- A passkey sign-in counts as a first factor: users who also have TOTP are
  asked for a code.
- Email delivery is out of band: a compromised inbox can reset the password.
  Users with MFA still need their second factor to sign in afterwards.
