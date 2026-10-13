/**
 * Requests per IP and minute on a sign-in, activation or PIN route, on top of the per-identifier
 * (or per-terminal) lockout of LoginLimiter, which is the main brute-force guard. One bound for
 * every such route.
 */
export const AUTH_ROUTE_LIMIT = { limit: 60, ttl: 60_000 };
