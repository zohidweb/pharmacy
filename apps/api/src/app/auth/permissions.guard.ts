import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Permission } from '@pharmacy/shared-domain';
import type { Request } from 'express';
import {
  type EmployeePrincipal,
  getPrincipal,
} from '../../common/context/request-context';
import { ProblemException } from '../../common/errors/problem.exception';
import type { StoreScopeOptions } from '../../common/guards/decorators';
import { resolveRouteAccess } from '../../common/guards/route-access';
import { isUuid, TenantDatabase } from '../../core/database';
import { AuditService } from '../audit/audit.service';

type DenyReason =
  | 'no_permission_declared'
  | 'missing_permission'
  | 'store_missing'
  | 'store_out_of_scope';

// A non-empty string value, or null (missing, repeated or of another type).
function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

// The store ids named by the request for each scope option that is set; null for a missing value.
function storeIdsOf(req: Request, scope: StoreScopeOptions): (string | null)[] {
  const ids: (string | null)[] = [];
  if (scope.storeParam !== undefined) {
    ids.push(stringValue(req.params?.[scope.storeParam]));
  }
  if (scope.storeQuery !== undefined) {
    ids.push(
      stringValue(
        (req.query as Record<string, unknown> | undefined)?.[scope.storeQuery],
      ),
    );
  }
  if (scope.storeBody !== undefined) {
    const body: unknown = req.body;
    const isObject =
      typeof body === 'object' && body !== null && !Array.isArray(body);
    ids.push(
      isObject
        ? stringValue((body as Record<string, unknown>)[scope.storeBody])
        : null,
    );
  }
  return ids;
}

// A PIN session works at its terminal's store only (ADR-0018 p. 3, ADR-0008).
function inScope(principal: EmployeePrincipal, storeId: string): boolean {
  if (principal.auth === 'pin' && storeId !== principal.currentStoreId) {
    return false;
  }
  return (
    principal.storeScope === 'all' || principal.storeScope.includes(storeId)
  );
}

// The error code or name only: database error messages may echo input values.
function describeFailure(error: unknown): string {
  if (error instanceof Error) {
    const code = (error as { code?: unknown }).code;
    return typeof code === 'string' ? `${error.name} ${code}` : error.name;
  }
  return typeof error;
}

// Global authorization guard (ADR-0018 p. 1, 3, 5, 9; auth design 2026-10-02, section 7,
// guard 4). Deny by default: a route needs @Public(), @Authenticated() or @RequirePermission().
// The route's marker is resolved at the nearest level (resolveRouteAccess, shared with AuthGuard):
// a handler marker replaces the class marker, so a class @Public() never opens a handler that
// declares a permission or @Authenticated(). The permission must be in the session's
// snapshot, and the store named by the request must be in the principal's scope. Every 403 is
// written to audit_log as access.denied (permission and store); a failed audit write is logged
// and the request is still denied.
@Injectable()
export class PermissionsGuard implements CanActivate {
  private readonly logger = new Logger(PermissionsGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly db: TenantDatabase,
    private readonly audit: AuditService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const access = resolveRouteAccess(this.reflector, context);
    if (access.kind === 'public') return true;

    // AuthGuard runs first; this is a second line, and a guest has no tenant to audit in.
    const principal = getPrincipal();
    if (!principal) throw new ProblemException(401, 'unauthenticated');

    if (access.kind === 'authenticated') return true;
    if (access.kind === 'none')
      return this.deny(null, 'no_permission_declared');

    const { permission, scope } = access;
    if (!principal.permissions.includes(permission)) {
      return this.deny(permission, 'missing_permission');
    }
    if (scope === undefined) return true;

    for (const storeId of storeIdsOf(
      context.switchToHttp().getRequest<Request>(),
      scope,
    )) {
      if (storeId === null) return this.deny(permission, 'store_missing');
      if (!inScope(principal, storeId)) {
        return this.deny(permission, 'store_out_of_scope', storeId);
      }
    }
    return true;
  }

  private async deny(
    permission: Permission | null,
    reason: DenyReason,
    storeId?: string,
  ): Promise<never> {
    // The store column is uuid; a malformed id from the request is not echoed into the audit.
    const event = {
      action: 'access.denied',
      ...(storeId !== undefined && isUuid(storeId) ? { storeId } : {}),
      details: { permission, reason },
    };
    try {
      await this.db.tenantTransaction((trx) => this.audit.append(trx, event));
    } catch (error) {
      this.logger.error(
        `access.denied audit write failed: ${describeFailure(error)}`,
      );
    }
    throw new ProblemException(403, 'forbidden');
  }
}
