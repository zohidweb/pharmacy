import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import type { TenantTransaction } from '../../core/database';

// A closed store leaves the discount rules (spec 2026-10-15-store-closing, E12): it is taken out of
// the store lists of the rules, and a rule whose list is left empty is archived — an empty list
// would read as «no store», a rule nobody can edit (its stores must be active). The prices of the
// store stay as its history.
@Injectable()
export class StoreDiscountDetachment {
  async detachStore(
    trx: TenantTransaction,
    tenantId: string,
    storeId: string,
  ): Promise<{ detached: number; archived: number }> {
    const detached = await sql<{ ruleId: string }>`
      delete from pharmacy.discount_rule_stores
      where tenant_id = ${tenantId} and store_id = ${storeId}
      returning rule_id`.execute(trx);
    const ruleIds = [...new Set(detached.rows.map((row) => row.ruleId))];
    if (ruleIds.length === 0) return { detached: 0, archived: 0 };
    const archived = await sql`
      update pharmacy.discount_rules r
      set status = 'archived', archived_at = now(), updated_at = now()
      where r.tenant_id = ${tenantId} and r.id = any(${sql.val(ruleIds)}::uuid[])
        and r.store_scope = 'list' and r.status = 'active'
        and not exists (
          select 1 from pharmacy.discount_rule_stores s
          where s.tenant_id = r.tenant_id and s.rule_id = r.id)`.execute(trx);
    return {
      detached: ruleIds.length,
      archived: Number(archived.numAffectedRows ?? 0),
    };
  }
}
