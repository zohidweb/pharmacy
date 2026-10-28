/** Public GET requests of the site (ADR-0023, P14): one raised bound per IP for everyone, the site renders from them. */
export const PUBLIC_READ_LIMIT = { limit: 1200, ttl: 60_000 };

/** Connection requests from the site form (ADR-0023, P6): 3 per hour per IP. */
export const CONNECTION_REQUEST_LIMIT = { limit: 3, ttl: 3_600_000 };
