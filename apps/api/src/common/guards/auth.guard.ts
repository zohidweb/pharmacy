import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { getOperator, getPrincipal } from '../context/request-context';
import { isOperatorPath } from '../http/contour';
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
    // The principal of the route's contour: an operator on /operator/*, an employee elsewhere.
    const { originalUrl } = context.switchToHttp().getRequest<Request>();
    const principal = isOperatorPath(originalUrl) ? getOperator() : getPrincipal();
    if (!principal) throw new ProblemException(401, 'unauthenticated');
    return true;
  }
}
