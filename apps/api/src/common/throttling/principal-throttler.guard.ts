import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { getOperator, getPrincipal } from '../context/request-context';
import { ProblemException } from '../errors/problem.exception';
import { isSyncPath, licenseKeyIdOf } from '../http/contour';

// Global throttling guard (auth design 2026-10-02, section 7, guard 3), after AuthGuard and
// CsrfGuard: an employee is limited by employee id whatever the IP (a shared pharmacy NAT does
// not merge cashiers), an operator by operator id, a guest by IP. Over the limit: 429 too_many_requests with Retry-After.
@Injectable()
export class PrincipalThrottlerGuard extends ThrottlerGuard {
  protected override async getTracker(
    req: Record<string, unknown>,
  ): Promise<string> {
    const principal = getPrincipal();
    if (principal) return principal.employeeId;
    const operator = getOperator();
    if (operator) return `op:${operator.operatorId}`;
    // An offline store by its license key id (ADR-0014 §6): many stores may share no IP, one store may
    // change it. An unparsable key falls back to the IP, which limits guessing.
    const request = req as {
      originalUrl?: string;
      headers?: Record<string, unknown>;
    };
    if (isSyncPath(request.originalUrl)) {
      const authorization = request.headers?.['authorization'];
      const keyId = licenseKeyIdOf(
        typeof authorization === 'string' ? authorization : undefined,
      );
      if (keyId) return `key:${keyId}`;
    }
    return super.getTracker(req);
  }

  // Retry-After is already set by ThrottlerGuard; the limit details are not exposed.
  protected override async throwThrottlingException(): Promise<void> {
    throw new ProblemException(429, 'too_many_requests');
  }
}
