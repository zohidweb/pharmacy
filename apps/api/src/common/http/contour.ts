// The two principal contours of the API (ADR-0013; auth design 2026-10-02, section 4): the
// platform operator owns exactly the /api/v1/operator/* routes, tenant employees everything else.
// The contour is chosen by the path only, so a token of the other contour is never even read.

const OPERATOR_PREFIX = '/api/v1/operator';

export function isOperatorPath(originalUrl: string | undefined): boolean {
  // Express always sets originalUrl; without one there is no operator route to reach.
  if (typeof originalUrl !== 'string') return false;
  // Express routing is case-insensitive by default, so the comparison is too.
  const path = originalUrl.split('?')[0].toLowerCase();
  return path === OPERATOR_PREFIX || path.startsWith(`${OPERATOR_PREFIX}/`);
}
