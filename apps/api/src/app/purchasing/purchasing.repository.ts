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
  /** Payments and credits of supplier returns allocated to the receipt. */
  allocatedDirams: bigint;
}

/** A payment or a posted supplier return with a rest to allocate (a credit of the supplier). */
export interface CreditRest {
  id: string;
  /** Payment date or business date of the return, YYYY-MM-DD. */
  date: string;
  at: Date;
  restDirams: bigint;
}

export interface PaymentRow {
  id: string;
  supplierId: string;
  legalEntityId: string;
  amountDirams: bigint;
  paidOn: string;
  method: string;
  comment: string | null;
}

export interface LedgerRow {
  kind: string;
  amountDirams: bigint;
  businessDate: string;
  sourceType: string;
  sourceId: string;
  recordedAt: Date;
  documentNumber: string | null;
  /** Type of the source document (`goods_receipt`, `supplier_return`); null for a payment. */
  documentType: string | null;
  paymentMethod: string | null;
  paymentComment: string | null;
}

export interface LedgerEntryValues {
  supplierId: string;
  legalEntityId: string;
  kind: 'goods_receipt' | 'payment' | 'supplier_return' | 'reversal';
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
             d.total_dirams,
             (coalesce((select sum(a.amount_dirams) from pharmacy.supplier_payment_allocations a
                        where a.tenant_id = d.tenant_id and a.goods_receipt_document_id = d.id), 0)
              + coalesce((select sum(r.amount_dirams) from pharmacy.supplier_return_allocations r
                          where r.tenant_id = d.tenant_id and r.goods_receipt_document_id = d.id), 0)
             )::bigint as allocated_dirams
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
             l.source_id, l.recorded_at, d.number as document_number, d.type as document_type,
             p.method as payment_method, p.comment as payment_comment
      from pharmacy.supplier_ledger_entries l
      left join pharmacy.documents d
        on d.tenant_id = l.tenant_id and l.source_type = 'document' and d.id = l.source_id
      left join pharmacy.supplier_payments p
        on p.tenant_id = l.tenant_id and l.source_type = 'payment' and p.id = l.source_id
      where l.tenant_id = ${tenantId} and l.supplier_id = ${supplierId}
      order by l.recorded_at, l.id`.execute(trx);
    return result.rows;
  }

  /** Active legal entities of the network. */
  async activeLegalEntities(
    trx: TenantTransaction,
    tenantId: string,
  ): Promise<string[]> {
    const rows = await trx
      .selectFrom('legalEntities')
      .select('id')
      .where('tenantId', '=', tenantId)
      .where('status', '=', 'active')
      .execute();
    return rows.map((r) => r.id);
  }

  async findPayment(
    trx: TenantTransaction,
    tenantId: string,
    id: string,
  ): Promise<PaymentRow | null> {
    const result = await sql<PaymentRow>`
      select id, supplier_id, legal_entity_id, amount_dirams, paid_on::text as paid_on, method,
             comment
      from pharmacy.supplier_payments
      where tenant_id = ${tenantId} and id = ${id}`.execute(trx);
    return result.rows[0] ?? null;
  }

  /** Inserts the payment; false when its id (the idempotency key) is already taken. */
  async insertPayment(
    trx: TenantTransaction,
    tenantId: string,
    payment: {
      id: string;
      supplierId: string;
      legalEntityId: string;
      amountDirams: number;
      paidOn: string;
      method: string;
      comment: string | null;
      createdBy: string;
    },
  ): Promise<boolean> {
    const result = await sql<{ id: string }>`
      insert into pharmacy.supplier_payments
        (tenant_id, id, supplier_id, legal_entity_id, amount_dirams, paid_on, method, comment,
         created_by)
      values (${tenantId}, ${payment.id}, ${payment.supplierId}, ${payment.legalEntityId},
              ${BigInt(payment.amountDirams)}, ${payment.paidOn}::date, ${payment.method},
              ${payment.comment}, ${payment.createdBy})
      on conflict (tenant_id, id) do nothing
      returning id`.execute(trx);
    return result.rows.length > 0;
  }

  /** Serialises the allocation of one supplier × legal entity (two payments, a payment and a receipt). */
  async lockSettlement(
    trx: TenantTransaction,
    tenantId: string,
    supplierId: string,
    legalEntityId: string,
  ): Promise<void> {
    await sql`select pg_advisory_xact_lock(
      hashtextextended(${`settlement:${tenantId}:${supplierId}:${legalEntityId}`}, 0))`.execute(
      trx,
    );
  }

  /**
   * Posted goods receipts of the supplier owed by the legal entity (by their ledger entries), with
   * a remainder after the allocations of payments and returns, the earliest due date first.
   */
  async openReceipts(
    trx: TenantTransaction,
    tenantId: string,
    supplierId: string,
    legalEntityId: string,
  ): Promise<Array<{ documentId: string; remainingDirams: bigint }>> {
    const result = await sql<{ documentId: string; remainingDirams: bigint }>`
      select d.id as document_id,
             (l.owed - coalesce(a.allocated, 0) - coalesce(r.allocated, 0))::bigint
               as remaining_dirams
      from pharmacy.documents d
      join (select source_id, sum(amount_dirams) as owed
            from pharmacy.supplier_ledger_entries
            where tenant_id = ${tenantId} and supplier_id = ${supplierId}
              and legal_entity_id = ${legalEntityId} and source_type = 'document'
            group by source_id) l on l.source_id = d.id
      left join (select goods_receipt_document_id, sum(amount_dirams) as allocated
                 from pharmacy.supplier_payment_allocations
                 where tenant_id = ${tenantId}
                 group by goods_receipt_document_id) a on a.goods_receipt_document_id = d.id
      left join (select goods_receipt_document_id, sum(amount_dirams) as allocated
                 from pharmacy.supplier_return_allocations
                 where tenant_id = ${tenantId}
                 group by goods_receipt_document_id) r on r.goods_receipt_document_id = d.id
      where d.tenant_id = ${tenantId} and d.type = 'goods_receipt' and d.status = 'posted'
        and l.owed - coalesce(a.allocated, 0) - coalesce(r.allocated, 0) > 0
      order by d.payment_due_date nulls last, d.document_date, d.number`.execute(
      trx,
    );
    return result.rows;
  }

  /** Payments of the supplier by the legal entity with an unallocated rest, the oldest first. */
  async paymentsWithRest(
    trx: TenantTransaction,
    tenantId: string,
    supplierId: string,
    legalEntityId: string,
  ): Promise<CreditRest[]> {
    const result = await sql<CreditRest>`
      select p.id, p.paid_on::text as date, p.created_at as at,
             (p.amount_dirams - coalesce(sum(a.amount_dirams), 0))::bigint as rest_dirams
      from pharmacy.supplier_payments p
      left join pharmacy.supplier_payment_allocations a
        on a.tenant_id = p.tenant_id and a.payment_id = p.id
      where p.tenant_id = ${tenantId} and p.supplier_id = ${supplierId}
        and p.legal_entity_id = ${legalEntityId}
      group by p.id, p.amount_dirams, p.paid_on, p.created_at
      having p.amount_dirams - coalesce(sum(a.amount_dirams), 0) > 0
      order by p.paid_on, p.created_at, p.id`.execute(trx);
    return result.rows;
  }

  /**
   * Posted supplier returns with a credit in the supplier × legal entity not allocated yet, the
   * oldest first. The credit of a return in a pair is minus its ledger entries there; it is
   * allocated only to receipts of that pair (those the pair still owes by their entries).
   */
  async returnsWithRest(
    trx: TenantTransaction,
    tenantId: string,
    supplierId: string,
    legalEntityId: string,
  ): Promise<CreditRest[]> {
    const result = await sql<CreditRest>`
      select c.id, c.date, c.at, (c.credit - coalesce(a.allocated, 0))::bigint as rest_dirams
      from (select l.source_id as id, min(l.business_date)::text as date, min(l.recorded_at) as at,
                   -sum(l.amount_dirams) as credit
            from pharmacy.supplier_ledger_entries l
            join pharmacy.documents d
              on d.tenant_id = l.tenant_id and d.id = l.source_id and d.type = 'supplier_return'
            where l.tenant_id = ${tenantId} and l.supplier_id = ${supplierId}
              and l.legal_entity_id = ${legalEntityId} and l.source_type = 'document'
            group by l.source_id) c
      left join (select ra.return_document_id, sum(ra.amount_dirams) as allocated
                 from pharmacy.supplier_return_allocations ra
                 where ra.tenant_id = ${tenantId}
                   and (select sum(e.amount_dirams) from pharmacy.supplier_ledger_entries e
                        where e.tenant_id = ra.tenant_id and e.source_type = 'document'
                          and e.source_id = ra.goods_receipt_document_id
                          and e.supplier_id = ${supplierId}
                          and e.legal_entity_id = ${legalEntityId}) > 0
                 group by ra.return_document_id) a on a.return_document_id = c.id
      where c.credit - coalesce(a.allocated, 0) > 0
      order by c.date, c.at, c.id`.execute(trx);
    return result.rows;
  }

  async addAllocation(
    trx: TenantTransaction,
    tenantId: string,
    paymentId: string,
    documentId: string,
    amountDirams: bigint,
  ): Promise<void> {
    await sql`
      insert into pharmacy.supplier_payment_allocations
        (tenant_id, payment_id, goods_receipt_document_id, amount_dirams)
      values (${tenantId}, ${paymentId}, ${documentId}, ${amountDirams})
      on conflict (tenant_id, payment_id, goods_receipt_document_id)
        do update set amount_dirams = pharmacy.supplier_payment_allocations.amount_dirams
                                      + excluded.amount_dirams`.execute(trx);
  }

  async addReturnAllocation(
    trx: TenantTransaction,
    tenantId: string,
    returnId: string,
    documentId: string,
    amountDirams: bigint,
  ): Promise<void> {
    await sql`
      insert into pharmacy.supplier_return_allocations
        (tenant_id, return_document_id, goods_receipt_document_id, amount_dirams)
      values (${tenantId}, ${returnId}, ${documentId}, ${amountDirams})
      on conflict (tenant_id, return_document_id, goods_receipt_document_id)
        do update set amount_dirams = pharmacy.supplier_return_allocations.amount_dirams
                                      + excluded.amount_dirams`.execute(trx);
  }

  /** Removes the credit allocations of a return, or those to a receipt; the total released. */
  async releaseReturnAllocations(
    trx: TenantTransaction,
    tenantId: string,
    by: { returnId: string } | { receiptId: string },
  ): Promise<number> {
    const result = await sql<{ amountDirams: bigint }>`
      delete from pharmacy.supplier_return_allocations
      where tenant_id = ${tenantId}
        and ${'returnId' in by ? sql`return_document_id = ${by.returnId}` : sql`goods_receipt_document_id = ${by.receiptId}`}
      returning amount_dirams`.execute(trx);
    return result.rows.reduce((sum, r) => sum + Number(r.amountDirams), 0);
  }

  /** Removes the allocations of a receipt; the total returned to the payments. */
  async releaseAllocations(
    trx: TenantTransaction,
    tenantId: string,
    documentId: string,
  ): Promise<number> {
    const result = await sql<{ amountDirams: bigint }>`
      delete from pharmacy.supplier_payment_allocations
      where tenant_id = ${tenantId} and goods_receipt_document_id = ${documentId}
      returning amount_dirams`.execute(trx);
    return result.rows.reduce((sum, r) => sum + Number(r.amountDirams), 0);
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
