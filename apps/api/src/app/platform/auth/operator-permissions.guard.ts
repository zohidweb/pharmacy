import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { OPERATOR_ROLE_PERMISSIONS } from '@pharmacy/shared-domain';
import type { Request } from 'express';
import {
  getOperator,
  getRequestContext,
  type OperatorPrincipal,
} from '../../../common/context/request-context';
import { ProblemException } from '../../../common/errors/problem.exception';
import { resolveRouteAccess } from '../../../common/guards/route-access';
import { isOperatorPath } from '../../../common/http/contour';
import { PlatformDatabase } from '../../../core/database/platform';
import { PlatformAuditService } from '../audit/platform-audit.service';

// Global guard of the operator contour (auth design 2026-10-02, section 9), after PermissionsGuard:
// a route of /api/v1/operator/* needs @Public() or @RequireOperatorPermission — anything else,
// @Authenticated() and tenant permissions included, is denied by default. An operator marker on
// any route needs an operator holding the permission; a tenant route never has one (401).
@Injectable()
export class OperatorPermissionsGuard implements CanActivate {
  private readonly logger = new Logger(OperatorPermissionsGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly db: PlatformDatabase,
    private readonly audit: PlatformAuditService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const access = resolveRouteAccess(this.reflector, context);
    const { originalUrl } = context.switchToHttp().getRequest<Request>();
    const operatorPath = isOperatorPath(originalUrl);
    if (!operatorPath && access.kind !== 'operator-permission') return true;
    if (operatorPath && access.kind === 'public') return true;

    const operator = getOperator();
    if (!operator) throw new ProblemException(401, 'unauthenticated');

    if (access.kind !== 'operator-permission') {
      return this.deny(operator, 'no_operator_permission_declared', null);
    }
    if (!OPERATOR_ROLE_PERMISSIONS[operator.role].includes(access.permission)) {
      return this.deny(operator, 'missing_permission', access.permission);
    }
    return true;
  }

  private async deny(
    operator: OperatorPrincipal,
    reason: string,
    permission: string | null,
  ): Promise<never> {
    try {
      await this.db.platformTransaction(
        { kind: 'operator', operatorId: operator.operatorId },
        (trx) =>
          this.audit.append(trx, {
            action: 'access.denied',
            details: { permission, reason },
          }),
      );
    } catch (error) {
      // The answer stays 403; the failure is logged by name, not swallowed silently.
      this.logger.error(
        `Operator access.denied audit write failed (${error instanceof Error ? error.name : typeof error}) [correlationId=${getRequestContext()?.correlationId}]`,
      );
    }
    throw new ProblemException(403, 'forbidden');
  }
}
