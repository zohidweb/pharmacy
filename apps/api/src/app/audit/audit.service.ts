import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { sql } from 'kysely';
import {
  getPrincipal,
  getRequestContext,
  requireTenantId,
} from '../../common/context/request-context';
import { newId, type TenantTransaction } from '../../core/database';

export interface AuditEvent {
  /** Event name, e.g. `access.denied`, `auth.login-succeeded`, `role.changed`. */
  action: string;
  entityType?: string;
  /** UUID of the entity (the column is uuid). */
  entityId?: string;
  /** UUID of the store the event concerns. */
  storeId?: string;
  /** Free-form facts about the event. Never passwords, PINs, tokens, codes or keys. */
  details?: Record<string, unknown>;
}

// Same default as tenant_settings.timezone, for a tenant without a settings row.
const DEFAULT_TIMEZONE = 'Asia/Dushanbe';

// Appends tenant audit events (audit_log, data model 06; ADR-0018 p. 9) inside the caller's
// tenant transaction, so the event commits or rolls back together with the operation it records.
// Who and where come from the request context, never from the caller: tenant, employee, terminal
// and correlation id. audit_log is append-only: there is no update or delete here.
@Injectable()
export class AuditService {
  private readonly source: 'cloud' | 'offline_store';

  constructor(config: ConfigService) {
    this.source =
      config.getOrThrow<string>('STORE_MODE') === 'cloud'
        ? 'cloud'
        : 'offline_store';
  }

  async append(trx: TenantTransaction, event: AuditEvent): Promise<void> {
    const tenantId = requireTenantId();
    // requireTenantId passed, so the context exists.
    const context = getRequestContext();
    if (!context) throw new Error('Request context is missing');
    // The tenant audit records employees only; an operator context has no tenant at all.
    const principal = getPrincipal();

    await trx
      .insertInto('auditLog')
      .values({
        tenantId,
        id: newId(),
        // Today in the tenant's time zone, in the same statement and transaction as the insert.
        businessDate: sql<string>`(now() at time zone coalesce(
          (select ts.timezone from tenant_settings ts where ts.tenant_id = ${tenantId}),
          ${DEFAULT_TIMEZONE}))::date`,
        employeeId: principal?.employeeId ?? null,
        terminalId: principal?.terminalId ?? null,
        storeId: event.storeId ?? null,
        correlationId: context.correlationId,
        action: event.action,
        entityType: event.entityType ?? null,
        entityId: event.entityId ?? null,
        details: JSON.stringify(event.details ?? {}),
        source: this.source,
      })
      .execute();
  }
}
