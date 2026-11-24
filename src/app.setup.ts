import { type INestApplication, ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { apiReference } from '@scalar/nestjs-api-reference';
import type { NextFunction, Request, Response } from 'express';
import type { Env } from './config/env.js';
import { API_PREFIX } from './auth/auth.options.js';
import { buildOpenApiDocument } from './openapi.js';

/** The API reference page loads its bundle from a CDN; only /docs allows it. */
const DOCS_CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net",
  "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com https://fonts.scalar.com",
  "img-src 'self' data: https:",
  "connect-src 'self'",
].join('; ');

/**
 * Everything around the routes: prefix, proxy trust, CORS, security headers,
 * CSRF protection, validation and API docs. Shared by main.ts and the tests,
 * so both run the same stack.
 */
export function configureApp(app: INestApplication, env: Env): void {
  const express = app as NestExpressApplication;
  app.setGlobalPrefix(API_PREFIX);

  if (env.TRUST_PROXY) {
    const hops = Number(env.TRUST_PROXY);
    express.set('trust proxy', Number.isInteger(hops) ? hops : env.TRUST_PROXY);
  }

  app.enableCors({ origin: env.CORS_ORIGIN, credentials: true });

  // Nest 12's built-ins: helmet's headers, and Fetch Metadata CSRF checks
  // for every state-changing request from another origin.
  app.useSecurityHeaders();
  app.enableCsrfProtection({ trustedOrigins: env.CORS_ORIGIN });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      errorFormat: 'grouped',
    }),
  );

  app.enableShutdownHooks();

  if (env.API_DOCS) {
    const document = buildOpenApiDocument(app);
    express.use('/openapi.json', (_req: Request, res: Response) =>
      res.json(document),
    );
    express.use(
      '/docs',
      (_req: Request, res: Response, next: NextFunction) => {
        res.setHeader('Content-Security-Policy', DOCS_CSP);
        next();
      },
      apiReference({ content: document, theme: 'default' }),
    );
  }
}
