import type { IncomingMessage } from 'node:http';
import { randomUUID } from 'node:crypto';
import type { Params } from 'nestjs-pino';
import type { Env } from '../../config/env.js';

const REQUEST_ID = /^[A-Za-z0-9._-]{1,128}$/;

/** pino-http options: request ids, redaction, quiet health checks. */
export function loggerParams(env: Env): Params {
  return {
    pinoHttp: {
      level: env.LOG_LEVEL,
      transport:
        env.NODE_ENV === 'development'
          ? {
              target: 'pino-pretty',
              options: { singleLine: true, ignore: 'pid,hostname' },
            }
          : undefined,
      // Reuse a well-formed incoming X-Request-Id, otherwise make one.
      genReqId: (req, res) => {
        const incoming = req.headers['x-request-id'];
        const id =
          typeof incoming === 'string' && REQUEST_ID.test(incoming)
            ? incoming
            : randomUUID();
        res.setHeader('X-Request-Id', id);
        return id;
      },
      redact: {
        paths: [
          'req.headers.authorization',
          'req.headers.cookie',
          'res.headers["set-cookie"]',
        ],
        censor: '[REDACTED]',
      },
      serializers: {
        req: (req: { id: string; method: string; url: string }) => ({
          id: req.id,
          method: req.method,
          url: req.url,
        }),
      },
      autoLogging: {
        ignore: (req: IncomingMessage) =>
          req.url?.startsWith('/api/v1/health') ?? false,
      },
    },
  };
}
