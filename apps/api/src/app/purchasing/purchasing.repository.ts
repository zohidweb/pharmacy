import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { newId, type TenantTransaction } from '../../core/database';

export interface SupplierRow {
  id: string;
  name: string;
  taxId: string | null;
  phone: string | null;
  address: string | null;
  paymentTermDays: number;
  status: string;
}

export interface SupplierValues {
  name: string;
  taxId: string | null;
  phone: string | null;
  address: string | null;
  paymentTermDays: number;
}

/** A posted goods receipt of a supplier as the debt sees it. */
export interface ReceiptRow {
  id: string;
  supplierId: string;
  number: string;
  documentDate: string;
  dueDate: string | null;
  storeId: string;
  storeName: string;
  totalDirams: bigint;
}

export interface LedgerRow {
  kind: string;
  amountDirams: bigint;
  businessDate: string;
  sourceType: string;
  sourceId: string;
  recordedAt: Date;
  documentNumber: string | null;
}

export interface LedgerEntryValues {
  supplierId: string;
  legalEntityId: string;
  kind: 'goods_receipt' | 'payment' | 'reversal';
  amountDirams: number;
  dueDate: string | null;
  sourceType: 'document' | 'payment';
  sourceId: string;
  businessDate: string;
  recordedBy: string;
}

// Data access of purchasing (spec 2026-10-09-inventory-purchasing, section 5). The headers of
// posted goods receipts are read here (number, date, store, total) for the debt and the supplier
// card; the stock module owns and writes them.
@Injectable()
export class PurchasingRepository {
  async businessDate(
    trx: TenantTransaction,
    tenantId: string,
  ): Promise<string> {
    const result = await sql<{ today: string }>`
      select (now() at time zone coalesce(
        (select timezone from pharmacy.tenant_settings where tenant_id = ${tenantId}),
        'Asia/Dushanbe'))::date::text as today`.execute(trx);
    return result.rows[0].today;
  }

  async listSuppliers(
    trx: TenantTransaction,
    tenantId: string,
  ): Promise<SupplierRow[]> {
    return trx
      .selectFrom('suppliers')
      .select([
        'id',
        'name',
        'taxId',
        'phone',
        'address',
        'paymentTermDays',
        'status',
      ])
      .where('tenantId', '=', tenantId)
      .orderBy(sql`lower(name)`)
      .orderBy('id')
      .execute();
  }

  async findSupplier(
    trx: TenantTransaction,
    tenantId: string,
    id: string,
  ): Promise<SupplierRow | null> {
    const row = await trx
      .selectFrom('suppliers')
      .select([
        'id',
        'name',
        'taxId',
        'phone',
        'address',
        'paymentTermDays',
        'status',
      ])
      .where('tenantId', '=', tenantId)
      .where('id', '=', id)
      .executeTakeFirst();
    return row ?? null;
  }

  /** Another supplier of the network with the same name whatever the case. */
  async nameTaken(
    trx: TenantTransaction,
    tenantId: string,
    name: string,
    exceptId: string | null,
  ): Promise<boolean> {
    const target = name.toLocaleLowerCase('ru');
    const rows = await trx
      .selectFrom('suppliers')
      .select(['id', 'name'])
      .where('tenantId', '=', tenantId)
      .execute();
    return rows.some(
      (row) =>
        row.id !== exceptId && row.name.toLocaleLowerCase('ru') === target,
    );
  }

  async insertSupplier(
    trx: TenantTransaction,
    tenantId: string,
    id: string,
    values: SupplierValues,
  ): Promise<void> {
    await trx
      .insertInto('suppliers')
      .values({ tenantId, id, ...values })
      .execute();
  }

  async updateSupplier(
    trx: TenantTransaction,
    tenantId: string,
    id: string,
    values: SupplierValues,
  ): Promise<void> {
    await trx
      .updateTable('suppliers')
      .set({ ...values, updatedAt: sql`now()` })
      .where('tenantId', '=', tenantId)
      .where('id', '=', id)
      .execute();
  }

  /** Posted goods receipts of the suppliers (all suppliers when `supplierId` is null). */
  async postedReceipts(
    trx: TenantTransaction,
    tenantId: string,
    supplierId: string | null,
  ): Promise<ReceiptRow[]> {
    const result = await sql<ReceiptRow>`
      select d.id, d.supplier_id, d.number, d.document_date::text as document_date,
             d.payment_due_date::text as due_date, d.store_id, s.name as store_name,
             d.total_dirams
      from pharmacy.documents d
      join pharmacy.stores s on s.tenant_id = d.tenant_id and s.id = d.store_id
      where d.tenant_id = ${tenantId} and d.type = 'goods_receipt' and d.status = 'posted'
        ${supplierId === null ? sql`` : sql`and d.supplier_id = ${supplierId}`}
      order by d.document_date desc, d.number desc`.execute(trx);
    return result.rows;
  }

  /** Entries of the supplier ledger, oldest first, with the number of the document. */
  async ledger(
    trx: TenantTransaction,
    tenantId: string,
    supplierId: string,
  ): Promise<LedgerRow[]> {
    const result = await sql<LedgerRow>`
      select l.kind, l.amount_dirams, l.business_date::text as business_date, l.source_type,
             l.source_id, l.recorded_at, d.number as document_number
      from pharmacy.supplier_ledger_entries l
      left join pharmacy.documents d
        on d.tenant_id = l.tenant_id and l.source_type = 'document' and d.id = l.source_id
      where l.tenant_id = ${tenantId} and l.supplier_id = ${supplierId}
      order by l.recorded_at, l.id`.execute(trx);
    return result.rows;
  }

  /** What a document left in the ledger, per supplier and legal entity. */
  async balancesOfSource(
    trx: TenantTransaction,
    tenantId: string,
    sourceId: string,
  ): Promise<
    Array<{ supplierId: string; legalEntityId: string; amountDirams: number }>
  > {
    const result = await sql<{
      supplierId: string;
      legalEntityId: string;
      amountDirams: bigint;
    }>`
      select supplier_id, legal_entity_id, sum(amount_dirams)::bigint as amount_dirams
      from pharmacy.supplier_ledger_entries
      where tenant_id = ${tenantId} and source_type = 'document' and source_id = ${sourceId}
      group by supplier_id, legal_entity_id`.execute(trx);
    return result.rows.map((r) => ({
      supplierId: r.supplierId,
      legalEntityId: r.legalEntityId,
      amountDirams: Number(r.amountDirams),
    }));
  }

  async appendLedger(
    trx: TenantTransaction,
    tenantId: string,
    entry: LedgerEntryValues,
  ): Promise<void> {
    await trx
      .insertInto('supplierLedgerEntries')
      .values({
        tenantId,
        id: newId(),
        ...entry,
        amountDirams: BigInt(entry.amountDirams),
      })
      .execute();
  }
}
