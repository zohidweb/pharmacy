import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  Logger,
  type NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Permission } from '@pharmacy/shared-domain';
import type { Request } from 'express';
import { catchError, from, mergeMap, type Observable, throwError } from 'rxjs';
import {
  getPrincipal,
  getRequestContext,
} from '../../common/context/request-context';
import { ProblemException } from '../../common/errors/problem.exception';
import { resolveRouteAccess } from '../../common/guards/route-access';
import { TenantDatabase } from '../../core/database';
import { AuditService } from '../audit/audit.service';

/**
 * A 403 `forbidden` for a permission other than the route's (e.g. `employees:assign-role` inside
 * an employee update): the audit names the permission that was missing.
 */
export class MissingPermissionException extends ProblemException {
  constructor(readonly permission: Permission) {
    super(403, 'forbidden');
  }
}

// ADR-0018, p. 9: every refusal is written to audit_log as access.denied. PermissionsGuard writes
// the refusals of the route's permission and store scope; the staff services refuse more on their
// own (a role or stores above the editor, one's own assignment). Their transaction has rolled
// back, so the event is written here in its own one, as the guard does: the permission of the
// route and the code of the refusal. The 403 itself goes on unchanged.
@Injectable()
export class AccessDeniedAudit implements NestInterceptor {
  private readonly logger = new Logger(AccessDeniedAudit.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly db: TenantDatabase,
    private readonly audit: AuditService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next
      .handle()
      .pipe(
        catchError((error: unknown) =>
          error instanceof ProblemException && error.getStatus() === 403
            ? from(this.record(context, error)).pipe(
                mergeMap(() => throwError(() => error)),
              )
            : throwError(() => error),
        ),
      );
  }

  private async record(
    context: ExecutionContext,
    error: ProblemException,
  ): Promise<void> {
    // The tenant audit records employees only.
    if (getPrincipal() === null) return;
    const access = resolveRouteAccess(this.reflector, context);
    const permission =
      error instanceof MissingPermissionException
        ? error.permission
        : access.kind === 'permission'
          ? access.permission
          : null;
    // What was asked, as the operator guard writes it: the method and the route pattern.
    const request = context.switchToHttp().getRequest<Request>();
    const route: unknown = (request.route as { path?: unknown } | undefined)
      ?.path;
    try {
      await this.db.tenantTransaction((trx) =>
        this.audit.append(trx, {
          action: 'access.denied',
          details: {
            permission,
            reason: error.code,
            method: request.method,
            route: typeof route === 'string' ? route : null,
          },
        }),
      );
    } catch (error) {
      // The answer stays 403; the failure is logged by name, not swallowed silently.
      this.logger.error(
        `access.denied audit write failed (${error instanceof Error ? error.name : typeof error}) [correlationId=${getRequestContext()?.correlationId}]`,
      );
    }
  }
}
