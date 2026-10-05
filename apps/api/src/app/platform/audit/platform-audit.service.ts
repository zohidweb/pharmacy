import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { sql, type Transaction } from 'kysely';
import { getRequestContext } from '../../../common/context/request-context';
import { type DB, newId } from '../../../core/database';

export interface PlatformAuditEvent {
  /** Event name, e.g. `auth.operator-login-succeeded`, `access.denied`, `operator.code-issued`. */
  action: string;
  /** The network the event concerns, if any. */
  tenantId?: string;
  entityType?: string;
  /** UUID of the entity (the column is uuid). */
  entityId?: string;
  /** Free-form facts. Never passwords, codes, tokens, keys or identifier values. */
  details?: Record<string, unknown>;
}

// Appends platform audit events (platform_audit_log, data model 06) inside the caller's platform
// transaction, so the event commits or rolls back with the operation it records. Who acted comes
// from the transaction's app.actor (`operator:<id>` or `system:<job>`, set by PlatformDatabase),
// never from the caller; the correlation id from the request context. Append-only: no update or
// delete here.
@Injectable()
export class PlatformAuditService {
  async append(trx: Transaction<DB>, event: PlatformAuditEvent): Promise<void> {
    const correlationId = getRequestContext()?.correlationId ?? randomUUID();
    await trx
      .insertInto('platformAuditLog')
      .values({
        id: newId(),
        actorKind: sql<string>`split_part(current_setting('app.actor'), ':', 1)`,
        operatorId: sql<string | null>`case when split_part(current_setting('app.actor'), ':', 1) = 'operator'
          then split_part(current_setting('app.actor'), ':', 2)::uuid end`,
        job: sql<string | null>`case when split_part(current_setting('app.actor'), ':', 1) = 'system'
          then split_part(current_setting('app.actor'), ':', 2) end`,
        action: event.action,
        tenantId: event.tenantId ?? null,
        entityType: event.entityType ?? null,
        entityId: event.entityId ?? null,
        details: JSON.stringify(event.details ?? {}),
        correlationId,
      })
      .execute();
  }
}
