# Customizing

## Add a permission

Policies live next to the feature they protect. Add an ability (a method
whose first parameter is the user) and reference it from a route:

```ts
// src/projects/project.policy.ts
@Policy()
export class ProjectPolicy implements PolicyBefore<AuthUser> {
  before(user: AuthUser | null) {
    return user?.role === 'ADMIN' ? true : undefined; // admins skip checks
  }

  update(user: AuthUser | null, projectOwnerId: string) {
    return user?.id === projectOwnerId;
  }
}

// src/projects/projects.controller.ts
@Can(ProjectPolicy, 'update', (ctx) => [ctx.switchToHttp().getRequest().params.ownerId])
@Patch(':id')
update() {}
```

For checks that need the record, call the service inside the handler:

```ts
const project = await this.projects.find(id);
await this.authorization.authorize(ProjectPolicy, 'update', user, project.ownerId);
```

Register the policy as a provider of its module. Remember: a route with no
`@Can()`, `@Can.Anyone()` or `@Public()` is denied.

## Add a role

Add it to `enum UserRole` in `prisma/schema.prisma`, run
`pnpm prisma:migrate`, and use it in policies (`user.role === 'MODERATOR'`).

## Store more on the user

Add the column in `prisma/schema.prisma`, migrate, then add the field to
`AuthUser` and `toAuthUser()` in `src/auth/auth.types.ts` if routes need it
from `@CurrentUser()`. Admin responses are built field by field in
`users.service.ts`, so new columns never leak by accident.

## Change the emails

Every email comes from `src/infra/mail/mail.templates.ts`. Swap in MJML or
React Email there; the auth code only calls the template functions.
To send through a provider API instead of SMTP, add a transport to
`MailService`.

## Turn features off, or remove them

Set `AUTH_MFA`, `AUTH_MAGIC_LINK`, `AUTH_API_KEYS` or `AUTH_PASSKEYS` to
`false`, or leave the Google/GitHub variables empty. To delete a feature
from the codebase, remove its folder and its line in
`src/auth/auth.module.ts`; the compiler shows what else referenced it.

## Add an OAuth provider

`@nestjs/authentication` ships `google()`, `github()` and `microsoft()`
presets, and any OIDC provider works with `{ issuer, clientId, clientSecret }`.
Add it to `providers` in `src/auth/auth.options.ts` and its variables to
`src/config/env.ts`.

## Use Drizzle, TypeORM or Redis for storage

Implement the store interfaces (`SessionStore`, `RefreshTokenStore`,
`MfaStore`, `EmailTokenStore`, `MagicLinkStore`, `OidcStateStore`) and call
`storage.registerSource({ … })` from the constructor, as
`PrismaAuthenticationStore` does. You can split them, for example sessions in
Redis and the rest in Postgres. Then point `test/stores.e2e-spec.ts` at your
store: the package's contract suite tells you whether it is correct,
including under concurrency.

## Add a frontend

The API expects your web app at `WEB_URL` with these pages, which POST the
`token` from the URL back to the API:

| Page | Calls |
| --- | --- |
| `/verify-email?token=…` | `POST /auth/email/verify` |
| `/reset-password?token=…` | `POST /auth/password/reset` with the new password |
| `/magic-link?token=…` | `POST /auth/magic-link/consume` |

Send requests with `credentials: 'include'`. For passkeys use
[`@simplewebauthn/browser`](https://simplewebauthn.dev): pass `options` from
the `…/options` routes to `startRegistration()` or `startAuthentication()`,
and post the result with the `challengeId`.
