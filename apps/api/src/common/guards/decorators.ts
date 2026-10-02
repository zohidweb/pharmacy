import { SetMetadata } from '@nestjs/common';

// Route access markers read by the global guards (auth design 2026-10-02, section 7). A route
// carries exactly one of @Public(), @Authenticated() or @RequirePermission(...) (app/auth); a
// route with none of them is denied by default (ADR-0018 p. 5).

export const IS_PUBLIC_KEY = 'pharmacy:isPublic';
export const IS_AUTHENTICATED_KEY = 'pharmacy:isAuthenticated';
export const REQUIRE_FRESH_AUTH_KEY = 'pharmacy:requireFreshAuth';

/** No principal needed (login, activation, health). CSRF is still checked. */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

/** Needs a principal but no catalog permission (own session, own profile). */
export const Authenticated = () => SetMetadata(IS_AUTHENTICATED_KEY, true);

/** Needs a session opened with a password no longer than STEP_UP_MAX_AGE_SECONDS ago. */
export const RequireFreshAuth = () => SetMetadata(REQUIRE_FRESH_AUTH_KEY, true);
