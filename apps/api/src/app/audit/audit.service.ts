import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { SyncAuditRow } from '@pharmacy/shared-dto';
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
  /**
   * UUID of the terminal of an event written without a principal (a PIN sign-in is audited before
   * its session exists). A principal's own terminal wins.
   */
  terminalId?: string;
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

  /**
   * A row of the audit journal of an offline store, as the store wrote it (ADR-0014 §4; spec
   * 2026-10-16-offline-sync, E9): its id, employee, terminal, correlation id and business date stay; the time
   * of recording is the cloud's (the journal is partitioned by it, and the clock of a store PC is not trusted
   * for that), the store's own time goes to `details.storeRecordedAt`.
   */
  async appendFact(
    trx: TenantTransaction,
    tenantId: string,
    row: SyncAuditRow,
    storeId: string,
  ): Promise<void> {
    await trx
      .insertInto('auditLog')
      .values({
        tenantId,
        id: row.id,
        businessDate: row.businessDate,
        employeeId: row.employeeId,
        terminalId: row.terminalId,
        storeId: row.storeId ?? storeId,
        correlationId: row.correlationId,
        action: row.action,
        entityType: row.entityType,
        entityId: row.entityId,
        details: JSON.stringify({
          ...row.details,
          storeRecordedAt: row.recordedAt,
        }),
        source: 'offline_store',
      })
      .execute();
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
        terminalId: principal?.terminalId ?? event.terminalId ?? null,
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
