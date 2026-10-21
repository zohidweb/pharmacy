import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import type { TenantTransaction } from '../../core/database';

/** A successful PIN sign-in on a terminal (`auth.pin-succeeded`). */
export interface PinSignIn {
  employeeId: string;
  at: Date;
}

// The PIN sign-ins of a terminal (spec 2026-10-21-pos-offline-limits, P10; ADR-0008, amendment 2026-10-21): the
// terminal is held by the last one who signed in on it, so the POS checks that the author of an operation sent
// under the terminal held it at the moment of the operation. Read in the caller's transaction, by the store index of
// the log.
@Injectable()
export class PinSignIns {
  async between(
    trx: TenantTransaction,
    tenantId: string,
    storeId: string,
    terminalId: string,
    from: Date,
    to: Date,
  ): Promise<PinSignIn[]> {
    const result = await sql<{ employeeId: string; at: Date }>`
      select a.entity_id as employee_id, a.recorded_at as at
      from pharmacy.audit_log a
      where a.tenant_id = ${tenantId} and a.store_id = ${storeId}
        and a.recorded_at between ${from} and ${to}
        and a.terminal_id = ${terminalId} and a.action = 'auth.pin-succeeded'
        and a.entity_id is not null
      order by a.recorded_at, a.id`.execute(trx);
    return result.rows;
  }
}
