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
// in the same transaction, and the audit log is append-only — so the history is complete. The wholesale price of a
// store changes only through PricesService.updateWholesale, which records `wholesale_price.changed` the same way (plan
// 2026-11-03-pos-store-ideas-pr3, R4): its new price is null when the wholesale is closed. Read in the caller's
// transaction, by audit_log_entity_idx (tenant, entity, time); every join keeps the tenant of the entry. The details
// of an offline store's entry came from the store: the document id is cast only when it is a uuid, and the store's
// time is shown only when it is a date (the order stays the cloud's time of recording, as the journal keeps it).

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

const UUID = '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';

/** The time of the change: an offline store's own time (`details.storeRecordedAt`) when it is a date. */
function changedAt(
  recordedAt: Date,
  logSource: string,
  storeRecordedAt: string | null,
): string {
  if (logSource !== 'offline_store' || storeRecordedAt === null) {
    return recordedAt.toISOString();
  }
  const storeTime = new Date(storeRecordedAt);
  return Number.isNaN(storeTime.getTime())
    ? recordedAt.toISOString()
    : storeTime.toISOString();
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
        and a.action in ('price.changed', 'wholesale_price.changed') ${stores}`;
    const rows = await sql<{
      id: string;
      action: string;
      recordedAt: Date;
      storeRecordedAt: string | null;
      storeId: string;
      storeName: string | null;
      oldPriceMinor: string | null;
      newPriceMinor: string | null;
      changeSource: string | null;
      logSource: string;
      documentId: string | null;
      documentType: string | null;
      documentNumber: string | null;
      authorName: string | null;
    }>`
      select a.id, a.action, a.recorded_at, a.details ->> 'storeRecordedAt' as store_recorded_at,
             a.store_id, s.name as store_name,
             a.details ->> 'oldPriceMinor' as old_price_minor,
             a.details ->> 'newPriceMinor' as new_price_minor,
             a.details ->> 'source' as change_source, a.source as log_source,
             d.id as document_id, d.type as document_type, d.number as document_number,
             e.full_name as author_name
      from pharmacy.audit_log a
      left join pharmacy.stores s on s.tenant_id = a.tenant_id and s.id = a.store_id
      left join pharmacy.documents d
        on d.tenant_id = a.tenant_id
          and d.id = case when a.details ->> 'documentId' ~* ${UUID}
                     then (a.details ->> 'documentId')::uuid end
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
        at: changedAt(row.recordedAt, row.logSource, row.storeRecordedAt),
        storeId: row.storeId,
        storeName: row.storeName ?? '',
        kind: row.action === 'wholesale_price.changed' ? 'wholesale' : 'retail',
        oldPriceMinor:
          row.oldPriceMinor === null ? null : Number(row.oldPriceMinor),
        newPriceMinor:
          row.newPriceMinor === null ? null : Number(row.newPriceMinor),
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
