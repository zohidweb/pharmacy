import { Injectable } from '@nestjs/common';
import type {
  Page,
  PriceChangeSource,
  PriceHistoryEntry,
} from '@pharmacy/shared-dto';
import { sql } from 'kysely';
import type { TenantTransaction } from '../../core/database';

// The history of the prices of a product (spec 2026-11-03-pos-store-ideas, D14–D16): a price of a store changes only
// through StorePriceWriter, which records `price.changed` with the old and the new price, the store and what changed it
// in the same transaction, and the audit log is append-only — so the history is complete. Read in the caller's
// transaction, by audit_log_entity_idx (tenant, entity, time); every join keeps the tenant of the entry.

/** `details.source` of `price.changed`; the offline store is told by the `source` column of the entry instead. */
function sourceOf(
  logSource: string,
  changeSource: string | null,
): PriceChangeSource {
  if (logSource === 'offline_store') return 'offline_store';
  if (changeSource === 'document') return 'document';
  if (changeSource === 'transfer') return 'transfer';
  return 'manual';
}

@Injectable()
export class PriceHistory {
  /** The changes of the prices of the product at the stores (null — every store), the newest first. */
  async page(
    trx: TenantTransaction,
    c: {
      tenantId: string;
      productId: string;
      storeIds: readonly string[] | null;
      limit: number;
      offset: number;
    },
  ): Promise<Page<PriceHistoryEntry>> {
    const stores =
      c.storeIds === null
        ? sql``
        : sql`and a.store_id = any(${sql.val([...c.storeIds])}::uuid[])`;
    const where = sql`
      a.tenant_id = ${c.tenantId} and a.entity_type = 'product' and a.entity_id = ${c.productId}
        and a.action = 'price.changed' ${stores}`;
    const rows = await sql<{
      id: string;
      recordedAt: Date;
      storeId: string;
      storeName: string | null;
      oldPriceMinor: string | null;
      newPriceMinor: string;
      changeSource: string | null;
      logSource: string;
      documentId: string | null;
      documentType: string | null;
      documentNumber: string | null;
      authorName: string | null;
    }>`
      select a.id, a.recorded_at, a.store_id, s.name as store_name,
             a.details ->> 'oldPriceMinor' as old_price_minor,
             a.details ->> 'newPriceMinor' as new_price_minor,
             a.details ->> 'source' as change_source, a.source as log_source,
             d.id as document_id, d.type as document_type, d.number as document_number,
             e.full_name as author_name
      from pharmacy.audit_log a
      left join pharmacy.stores s on s.tenant_id = a.tenant_id and s.id = a.store_id
      left join pharmacy.documents d
        on d.tenant_id = a.tenant_id and d.id = (a.details ->> 'documentId')::uuid
      left join pharmacy.employees e on e.tenant_id = a.tenant_id and e.id = a.employee_id
      where ${where}
      order by a.recorded_at desc, a.id desc
      limit ${c.limit} offset ${c.offset}`.execute(trx);
    const count = await sql<{ total: string }>`
      select count(*) as total from pharmacy.audit_log a where ${where}`.execute(
      trx,
    );
    return {
      items: rows.rows.map((row) => ({
        id: row.id,
        at: row.recordedAt.toISOString(),
        storeId: row.storeId,
        storeName: row.storeName ?? '',
        kind: 'retail',
        oldPriceMinor:
          row.oldPriceMinor === null ? null : Number(row.oldPriceMinor),
        newPriceMinor: Number(row.newPriceMinor),
        source: sourceOf(row.logSource, row.changeSource),
        document:
          row.documentId === null
            ? null
            : {
                id: row.documentId,
                type: row.documentType ?? '',
                number: row.documentNumber ?? '',
              },
        author: row.authorName === null ? null : { name: row.authorName },
      })),
      total: Number(count.rows[0]?.total ?? 0),
      limit: c.limit,
      offset: c.offset,
    };
  }
}
