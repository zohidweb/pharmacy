import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  Logger,
  type OnModuleInit,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
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
export class OperatorPermissionsGuard implements CanActivate, OnModuleInit {
  private readonly logger = new Logger(OperatorPermissionsGuard.name);
  private readonly cloud: boolean;

  constructor(
    private readonly reflector: Reflector,
    config: ConfigService,
    // Absent on an offline store, which has no operator contour (every request there is denied
    // before an audit would be written: no operator principal ever exists).
    @Optional() private readonly db?: PlatformDatabase,
    @Optional() private readonly audit?: PlatformAuditService,
  ) {
    this.cloud = config.getOrThrow<string>('STORE_MODE') === 'cloud';
  }

  // The dependencies are optional for the offline store only. In the cloud a wiring mistake (the
  // operator module not registered) would refuse every operator silently, with no audit: the
  // process does not start instead.
  onModuleInit(): void {
    if (this.cloud && (!this.db || !this.audit)) {
      throw new Error(
        'The operator contour is not wired in cloud mode: PlatformDatabase or PlatformAuditService is missing',
      );
    }
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const access = resolveRouteAccess(this.reflector, context);
    const request = context.switchToHttp().getRequest<Request>();
    const { originalUrl } = request;
    const operatorPath = isOperatorPath(originalUrl);
    if (!operatorPath && access.kind !== 'operator-permission') return true;
    if (operatorPath && access.kind === 'public') return true;

    const operator = getOperator();
    if (!operator) throw new ProblemException(401, 'unauthenticated');

    if (access.kind !== 'operator-permission') {
      return this.deny(
        operator,
        request,
        'no_operator_permission_declared',
        null,
      );
    }
    if (!OPERATOR_ROLE_PERMISSIONS[operator.role].includes(access.permission)) {
      return this.deny(
        operator,
        request,
        'missing_permission',
        access.permission,
      );
    }
    return true;
  }

  private async deny(
    operator: OperatorPrincipal,
    request: Request,
    reason: string,
    permission: string | null,
  ): Promise<never> {
    // What was asked: the method and the route pattern (`/…/tenants/:id/block`), not the URL with
    // its values.
    const route: unknown = (request.route as { path?: unknown } | undefined)
      ?.path;
    const target = {
      method: request.method,
      route: typeof route === 'string' ? route : null,
    };
    const { db, audit } = this;
    if (!db || !audit) throw new ProblemException(403, 'forbidden');
    try {
      await db.platformTransaction(
        { kind: 'operator', operatorId: operator.operatorId },
        (trx) =>
          audit.append(trx, {
            action: 'access.denied',
            details: { permission, reason, ...target },
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
