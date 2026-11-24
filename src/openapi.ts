import type { INestApplication } from '@nestjs/common';
import {
  DocumentBuilder,
  SwaggerModule,
  type OpenAPIObject,
} from '@nestjs/swagger';

export function buildOpenApiDocument(app: INestApplication): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle('NestJS Auth Starter')
    .setDescription(
      [
        'Authentication and authorization on the official `@nestjs/authentication` and `@nestjs/authorization` packages.',
        '',
        '- **Browsers** sign in with `POST /auth/login` and get an HttpOnly `__Host-sid` session cookie.',
        '- **Mobile apps and CLIs** use `POST /auth/token` for a Bearer access token and a rotating refresh token.',
        '- **Scripts** use personal API keys (`Authorization: Bearer nak_…`).',
        '',
        'Errors are RFC 9457 problem details with a stable `errorCode`.',
      ].join('\n'),
    )
    .setVersion('2.0.0')
    .addCookieAuth('__Host-sid', { type: 'apiKey', in: 'cookie' }, 'session')
    .addBearerAuth(
      { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      'bearer',
    )
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        description: 'API key: nak_<id>_<secret>',
      },
      'apiKey',
    )
    .addSecurityRequirements('session')
    .addSecurityRequirements('bearer')
    .addSecurityRequirements('apiKey')
    .build();
  return SwaggerModule.createDocument(app, config);
}
