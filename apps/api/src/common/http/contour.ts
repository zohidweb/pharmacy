// The two principal contours of the API (ADR-0013; auth design 2026-10-02, section 4): the
// platform operator owns exactly the /api/v1/operator/* routes, tenant employees everything else.
// The contour is chosen by the path only, so a token of the other contour is never even read.

const OPERATOR_PREFIX = '/api/v1/operator';
const SYNC_PREFIX = '/api/v1/sync';

export function isOperatorPath(originalUrl: string | undefined): boolean {
  // Express always sets originalUrl; without one there is no operator route to reach.
  if (typeof originalUrl !== 'string') return false;
  // A request target that is not origin-form (e.g. absolute-form `http://host/api/v1/operator/…`,
  // which Express still routes by its path) gets the strictest contour: the operator one, where
  // only @Public or an operator permission passes. A tenant route reached that way is denied, an
  // operator route still needs an operator — the contour can never be the more permissive one.
  if (!originalUrl.startsWith('/')) return true;
  // Express routing is case-insensitive by default, so the comparison is too.
  const path = originalUrl.split('?')[0].toLowerCase();
  return path === OPERATOR_PREFIX || path.startsWith(`${OPERATOR_PREFIX}/`);
}

// The sync contour of offline stores (ADR-0014 §6; spec 2026-10-16-offline-sync, E10): a store authenticates with
// its license key, not with a session cookie. Origin-form paths only.
export function isSyncPath(originalUrl: string | undefined): boolean {
  if (typeof originalUrl !== 'string' || !originalUrl.startsWith('/'))
    return false;
  const path = originalUrl.split('?')[0].toLowerCase();
  return path === SYNC_PREFIX || path.startsWith(`${SYNC_PREFIX}/`);
}

// The loads of data from a file (spec 2026-10-20-data-import, F19): their JSON body holds up to 20 000 rows, so these
// routes — the load and its check — take a body of up to 10 MB. Origin-form paths only.
const IMPORT_PATH =
  /^\/api\/v1\/(catalog|opening-balance|supplier)-imports(\/checks)?\/?$/;

export function isImportPath(originalUrl: string | undefined): boolean {
  if (typeof originalUrl !== 'string' || !originalUrl.startsWith('/'))
    return false;
  return IMPORT_PATH.test(originalUrl.split('?')[0].toLowerCase());
}

// `Authorization: Bearer phk_<keyId>_<secret>` — the open key id, or null for any other header.
export function licenseKeyIdOf(
  authorization: string | undefined,
): string | null {
  const match = /^Bearer phk_([0-9a-f]{16})_[A-Za-z0-9_-]{43}$/.exec(
    authorization ?? '',
  );
  return match ? match[1] : null;
}
