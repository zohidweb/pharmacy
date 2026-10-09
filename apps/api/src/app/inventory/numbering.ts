import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import type { TenantTransaction } from '../../core/database';

export type NumberedKind = 'goods_receipt' | 'opening_balance';

// Prefixes are constants of the code, not a column: old numbers stay as they were (data model 03).
const PREFIX: Record<NumberedKind, string> = {
  goods_receipt: 'ПР',
  opening_balance: 'НО',
};

// Numbers of stock documents: `<prefix>-<store code>-<year>-<6 digits>`, a counter per store, kind
// and year of the document date, taken in the transaction of the document.
@Injectable()
export class Numbering {
  async next(
    trx: TenantTransaction,
    tenantId: string,
    store: { id: string; code: string },
    kind: NumberedKind,
    date: string,
  ): Promise<string> {
    const year = Number(date.slice(0, 4));
    const result = await sql<{ lastNumber: bigint }>`
      insert into pharmacy.document_counters (tenant_id, store_id, kind, year, last_number)
      values (${tenantId}, ${store.id}, ${kind}, ${year}, 1)
      on conflict (tenant_id, store_id, kind, year)
        do update set last_number = pharmacy.document_counters.last_number + 1
      returning last_number`.execute(trx);
    const n = String(result.rows[0].lastNumber).padStart(6, '0');
    return `${PREFIX[kind]}-${store.code}-${year}-${n}`;
  }
}
