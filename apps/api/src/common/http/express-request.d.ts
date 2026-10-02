// Request fields set by the API's own middleware (declaration merging with @types/express).
declare namespace Express {
  interface Request {
    /** Set by CorrelationIdMiddleware: a validated client id or a random UUID. */
    correlationId?: string;
  }
}
