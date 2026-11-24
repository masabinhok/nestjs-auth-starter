declare global {
  namespace Express {
    interface Request {
      /** Set by CorrelationIdMiddleware for every request. */
      correlationId?: string;
    }
  }
}

export {};
