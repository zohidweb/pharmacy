import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import type { TenantTransaction } from '../../core/database';

/** A store as the POS sees it: the receipt header and the rules of a sale. */
export interface PosStore {
  id: string;
  code: string;
  name: string;
  address: string;
  mode: string;
  status: string;
  legalEntityId: string;
  taxId: string;
  /** Closed period of the legal entity of the store, YYYY-MM-DD. */
  closedUntil: string | null;
}

/** Settings of the network the POS needs. */
export interface PosSettings {
  networkName: string;
  defaultLanguage: 'ru' | 'tj';
  returnPeriodDays: number;
  /** `{ ru, tj }` or null. */
  receiptFooter: unknown;
  pieceStepDirams: number;
}

// Organisation data the POS reads (stores, legal entities, the network and its settings) — the
// reference tables every module reads directly, as the stock module does (StoreAccess). The stock,
// the catalog and the prices come through the public interfaces of their modules.
@Injectable()
export class PosRepository {
  /** `lock: 'share'` — the opening of a shift and the closing of the store do not cross. */
  async store(
    trx: TenantTransaction,
    tenantId: string,
    storeId: string,
    options: { lock?: 'share' } = {},
  ): Promise<PosStore | null> {
    const result = await sql<PosStore>`
      select s.id, s.code, s.name, s.address, s.mode, s.status, s.legal_entity_id,
             le.tax_id, le.closed_until::text as closed_until
      from pharmacy.stores s
      join pharmacy.legal_entities le on le.tenant_id = s.tenant_id and le.id = s.legal_entity_id
      where s.tenant_id = ${tenantId} and s.id = ${storeId}
      ${options.lock === 'share' ? sql`for share of s` : sql``}`.execute(trx);
    return result.rows[0] ?? null;
  }

  async settings(
    trx: TenantTransaction,
    tenantId: string,
  ): Promise<PosSettings> {
    const result = await sql<{
      networkName: string;
      defaultLanguage: string | null;
      returnPeriodDays: number | null;
      receiptFooter: unknown;
      pieceStepDirams: number | null;
    }>`
      select t.name as network_name, ts.default_language, ts.return_period_days,
             ts.receipt_footer, ts.piece_price_rounding_dirams as piece_step_dirams
      from pharmacy.tenants t
      left join pharmacy.tenant_settings ts on ts.tenant_id = t.id
      where t.id = ${tenantId}`.execute(trx);
    const row = result.rows[0];
    return {
      networkName: row?.networkName ?? '',
      defaultLanguage: row?.defaultLanguage === 'tj' ? 'tj' : 'ru',
      returnPeriodDays: row?.returnPeriodDays ?? 14,
      receiptFooter: row?.receiptFooter ?? null,
      pieceStepDirams: Math.max(1, row?.pieceStepDirams ?? 1),
    };
  }

  /** The business date of a moment in the time zone of the network, YYYY-MM-DD. */
  async businessDate(
    trx: TenantTransaction,
    tenantId: string,
    moment: Date,
  ): Promise<string> {
    const result = await sql<{ date: string }>`
      select (${moment}::timestamptz at time zone coalesce(
        (select ts.timezone from pharmacy.tenant_settings ts where ts.tenant_id = ${tenantId}),
        'Asia/Dushanbe'))::date::text as date`.execute(trx);
    return result.rows[0].date;
  }
}
