import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { getPrincipal } from '../context/request-context';
import { ProblemException } from '../errors/problem.exception';
import { resolveRouteAccess } from './route-access';

// First global guard (auth design 2026-10-02, section 7, guard 1): every route except a public
// one needs the principal the session middleware put into the request context. Public is resolved
// at the nearest level (resolveRouteAccess), the same way PermissionsGuard resolves it.
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    if (resolveRouteAccess(this.reflector, context).kind === 'public') {
      return true;
    }
    if (!getPrincipal()) throw new ProblemException(401, 'unauthenticated');
    return true;
  }
}
