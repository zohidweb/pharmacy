import { Injectable } from '@nestjs/common';
import { sql, type Transaction } from 'kysely';
import type { DB } from '../../../core/database';

// The networks of the platform for the hourly purge (ADR-0013, amendment 2026-10-21): every network, whatever its
// status — a blocked or a closed network keeps no prescription data past its term either.
@Injectable()
export class RetentionRepository {
  async tenantIds(trx: Transaction<DB>): Promise<string[]> {
    const result = await sql<{ id: string }>`
      select t.id from pharmacy.tenants t order by t.id`.execute(trx);
    return result.rows.map((row) => row.id);
  }
}
