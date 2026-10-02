import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { getPrincipal } from '../context/request-context';
import { ProblemException } from '../errors/problem.exception';
import { IS_PUBLIC_KEY } from './decorators';

// First global guard (auth design 2026-10-02, section 7, guard 1): every route except @Public()
// needs the principal the session middleware put into the request context.
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean | undefined>(
      IS_PUBLIC_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (isPublic) return true;
    if (!getPrincipal()) throw new ProblemException(401, 'unauthenticated');
    return true;
  }
}
