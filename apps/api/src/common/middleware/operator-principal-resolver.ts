import type { OperatorPrincipal } from '../context/request-context';

// Port: the operator of an operator-contour token (auth design 2026-10-02, section 9). The
// implementation lives in app/platform/auth (it reads operators through PlatformDatabase, which
// only app/platform/** may import); the session middleware sees this abstraction only. Not
// provided on an offline store: the operator contour then always resolves to a guest. DI token.
export abstract class OperatorPrincipalResolver {
  /** The operator, or null for an invalid, foreign, expired or revoked token or a blocked operator. */
  abstract resolve(token: string): Promise<OperatorPrincipal | null>;
}
