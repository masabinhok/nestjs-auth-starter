# Deployment

## Checklist

- [ ] Generate `AUTH_JWT_SECRET` and `AUTH_MFA_ENCRYPTION_KEY`
      (`openssl rand -base64 32` each) and keep them in your platform's secret store.
- [ ] Set `APP_URL`, `WEB_URL` and `CORS_ORIGIN` to your public URLs (HTTPS).
- [ ] Set `TRUST_PROXY` to match your load balancer (usually `1`).
- [ ] Point `SMTP_URL` and `MAIL_FROM` at a real mail service.
- [ ] Set `REDIS_URL` if you run more than one instance.
- [ ] Run migrations before starting new code: `prisma migrate deploy`.
- [ ] Register OAuth callback URLs: `${APP_URL}/api/v1/auth/oidc/<provider>/callback`.
- [ ] Consider `API_DOCS=false` if the API is not public.
- [ ] Never run `pnpm prisma:seed` against production (it refuses to anyway).

The app refuses to start in production without real storage for the
enabled auth features, and on any invalid setting.

## Container image

Releases publish a multi-arch image:

```bash
docker run -p 8080:8080 --env-file .env ghcr.io/masabinhok/nestjs-auth-starter:2
```

Or build it: `docker build --target runtime -t my-api .`. Run migrations
with the `deps` stage, which includes the Prisma CLI:

```bash
docker build --target deps -t my-api-migrate .
docker run --rm -e DATABASE_URL=… my-api-migrate pnpm prisma migrate deploy
```

## Health checks

| Probe | Path | Checks |
| --- | --- | --- |
| Liveness | `GET /api/v1/health/live` | The process serves requests |
| Readiness | `GET /api/v1/health` | Postgres answers within 1.5 s |

Neither is rate limited. The image's `HEALTHCHECK` uses the liveness probe.

## Kubernetes

```yaml
livenessProbe:
  httpGet: { path: /api/v1/health/live, port: 8080 }
readinessProbe:
  httpGet: { path: /api/v1/health, port: 8080 }
```

Run `prisma migrate deploy` as an init container or a pre-deploy job from
the `deps` image. Shutdown is graceful: the app drains in-flight requests on
`SIGTERM`.

## Platforms

Any platform that runs a container and gives you Postgres works (Fly.io,
Render, Railway, Cloud Run, ECS). Set the variables above, run migrations as
a release command, and use `/api/v1/health` as the health check path.
