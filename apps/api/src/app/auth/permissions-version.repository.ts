import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import type { TenantTransaction } from '../../core/database';

export interface BumpedVersion {
  employeeId: string;
  version: number;
}

// Data access of the permissions version (auth design 2026-10-02, section 7). Runs in the caller's
// tenant transaction and filters by tenant_id; RLS is the second line.
@Injectable()
export class PermissionsVersionRepository {
  /** Increments permissions_version of the listed employees; returns the new versions. */
  async bump(
    trx: TenantTransaction,
    tenantId: string,
    employeeIds: readonly string[],
  ): Promise<BumpedVersion[]> {
    const rows = await trx
      .updateTable('employees')
      .set({ permissionsVersion: sql<bigint>`permissions_version + 1` })
      .where('tenantId', '=', tenantId)
      .where('id', 'in', [...employeeIds])
      .returning(['id', 'permissionsVersion'])
      .execute();
    return rows.map((row) => {
      // The column is bigint (a string from pg); a version stays far below 2^53.
      const version = Number(row.permissionsVersion);
      if (!Number.isSafeInteger(version)) {
        throw new Error('permissions_version is out of the safe integer range');
      }
      return { employeeId: row.id, version };
    });
  }
}
