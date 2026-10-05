import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { getPrincipal } from '../context/request-context';
import { ProblemException } from '../errors/problem.exception';
import { REQUIRE_FRESH_AUTH_KEY } from './decorators';

// Step-up guard, last in the chain (auth design 2026-10-02, section 7, guard 5): a
// @RequireFreshAuth() route (terminal binding, employees and roles, own password and PIN) needs a
// session opened with a password no longer than STEP_UP_MAX_AGE_SECONDS ago. A PIN session never
// qualifies.
@Injectable()
export class FreshAuthGuard implements CanActivate {
  private readonly maxAgeMs: number;

  constructor(
    private readonly reflector: Reflector,
    config: ConfigService,
  ) {
    this.maxAgeMs = config.getOrThrow<number>('STEP_UP_MAX_AGE_SECONDS') * 1000;
  }

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<boolean | undefined>(
      REQUIRE_FRESH_AUTH_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!required) return true;

    const principal = getPrincipal();
    if (!principal) throw new ProblemException(401, 'unauthenticated');

    // NaN (an unparseable timestamp) fails the comparison and is rejected. A timestamp slightly
    // in the future (clock skew between API instances) counts as fresh.
    const age = Date.now() - Date.parse(principal.authenticatedAt);
    if (principal.auth !== 'password' || !(age <= this.maxAgeMs)) {
      throw new ProblemException(403, 'fresh_auth_required');
    }
    return true;
  }
}
