import { SetMetadata } from '@nestjs/common';
import type {
  OperatorPermission,
  Permission,
} from '@pharmacy/shared-domain';

// Route access markers read by the global guards (auth design 2026-10-02, section 7). A route
// carries exactly one of @Public(), @Authenticated() or @RequirePermission(...) (app/auth); a
// route with none of them is denied by default (ADR-0018 p. 5). The nearest level wins: a marker
// on the handler replaces the class marker entirely (see resolveRouteAccess).

export const IS_PUBLIC_KEY = 'pharmacy:isPublic';
export const IS_AUTHENTICATED_KEY = 'pharmacy:isAuthenticated';
export const REQUIRE_FRESH_AUTH_KEY = 'pharmacy:requireFreshAuth';
// Set by @RequirePermission (app/auth/decorators.ts); defined here so that every guard resolves
// the route's access the same way.
export const REQUIRED_PERMISSION_KEY = 'pharmacy:requiredPermission';
// Set by @RequireOperatorPermission (app/platform/auth/decorators.ts): the operator contour.
export const REQUIRED_OPERATOR_PERMISSION_KEY = 'pharmacy:requiredOperatorPermission';

// Where the store of a request is read from: a route parameter, a query parameter or a top-level
// body field. When an option is set, the value is required and must be in the principal's scope.
export interface StoreScopeOptions {
  storeParam?: string;
  storeQuery?: string;
  storeBody?: string;
}

export interface PermissionRequirement {
  permission: Permission;
  scope?: StoreScopeOptions;
}

export interface OperatorPermissionRequirement {
  permission: OperatorPermission;
}

/** No principal needed (login, activation, health). CSRF is still checked. */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

/** Needs a principal but no catalog permission (own session, own profile). */
export const Authenticated = () => SetMetadata(IS_AUTHENTICATED_KEY, true);

/** Needs a session opened with a password no longer than STEP_UP_MAX_AGE_SECONDS ago. */
export const RequireFreshAuth = () => SetMetadata(REQUIRE_FRESH_AUTH_KEY, true);
