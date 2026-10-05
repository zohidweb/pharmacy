import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { getOperator, getPrincipal } from '../context/request-context';
import { ProblemException } from '../errors/problem.exception';

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
    return super.getTracker(req);
  }

  // Retry-After is already set by ThrottlerGuard; the limit details are not exposed.
  protected override async throwThrottlingException(): Promise<void> {
    throw new ProblemException(429, 'too_many_requests');
  }
}
