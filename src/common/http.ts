import type { Request } from 'express';

/** Client details recorded with sessions and audit events. */
export interface ClientInfo {
  ip?: string;
  userAgent?: string;
}

/** `req.ip` honours TRUST_PROXY; raw forwarding headers are never read. */
export function clientInfo(req: Request): ClientInfo {
  return {
    ip: req.ip,
    userAgent: req.headers['user-agent']?.slice(0, 255),
  };
}
