import { Injectable } from '@nestjs/common';
import type { DrugReferenceItem, PrescriptionKind } from '@pharmacy/shared-dto';
import { type SqlBool, sql } from 'kysely';
import { escapeLike, type TenantTransaction } from '../../core/database';
import { nameOf } from './catalog.repository';

const BARCODE = /^[0-9]{8,14}$/;

function prescriptionOf(row: {
  isPrescription: boolean;
  isControlled: boolean;
}): PrescriptionKind {
  if (row.isControlled) return 'controlled';
  return row.isPrescription ? 'rx' : 'none';
}

/**
 * The platform drug reference (ADR-0013, class `shared`; plan 2026-11-11-drug-reference-seed, R9). The tables have no
 * tenant_id: every network reads the whole reference (RLS `tenant_read` for pharmacy_app, SELECT only), so the query
 * runs in the tenant transaction without a tenant filter. Only the operator writes it (the seed script).
 */
@Injectable()
export class DrugReferencesRepository {
  /** 8–14 digits — a barcode exactly; other text — a part of the name RU/TJ or of the МНН. Active entries only. */
  async search(
    trx: TenantTransaction,
    q: string,
    page: { limit: number; offset: number },
  ): Promise<{ items: DrugReferenceItem[]; total: number }> {
    // case-insensitive and `ё` as `е` on both sides (the trigram indexes are on the same expressions)
    const text = escapeLike(q.toLocaleLowerCase('ru').replace(/ё/g, 'е'));
    const ru = sql`replace(lower(r.name ->> 'ru'), 'ё', 'е')`;
    const tj = sql`replace(lower(r.name ->> 'tj'), 'ё', 'е')`;
    const match = BARCODE.test(q)
      ? sql<SqlBool>`exists (select 1 from pharmacy.drug_reference_barcodes b
          where b.drug_reference_id = r.id and b.barcode = ${q})`
      : sql<SqlBool>`(${ru} like ${`%${text}%`} or ${tj} like ${`%${text}%`}
          or replace(lower(r.inn ->> 'ru'), 'ё', 'е') like ${`%${text}%`})`;
    const base = trx
      .selectFrom('drugReference as r')
      .where('r.status', '=', 'active')
      .where(match);

    const counted = await base
      .select(sql<number>`count(*)::int`.as('total'))
      .executeTakeFirstOrThrow();
    const rows = await base
      .select([
        'r.id',
        'r.name',
        'r.inn',
        'r.dosageForm',
        'r.dosage',
        'r.manufacturer',
        'r.country',
        'r.isPrescription',
        'r.isControlled',
        sql<
          string[]
        >`array(select b.barcode from pharmacy.drug_reference_barcodes b
          where b.drug_reference_id = r.id order by b.barcode)`.as('barcodes'),
      ])
      // a name that starts with the query first, then by the name
      .orderBy(
        sql`case when ${ru} like ${`${text}%`} or ${tj} like ${`${text}%`} then 0 else 1 end`,
      )
      .orderBy(ru)
      .orderBy('r.id')
      .limit(page.limit)
      .offset(page.offset)
      .execute();

    return {
      total: counted.total,
      items: rows.map((row) => ({
        id: row.id,
        nameRu: nameOf(row.name, 'ru'),
        nameTj: nameOf(row.name, 'tj'),
        inn: nameOf(row.inn, 'ru'),
        form: row.dosageForm ?? '',
        dosage: row.dosage ?? '',
        manufacturer: row.manufacturer ?? '',
        countryCode: row.country ?? '',
        prescription: prescriptionOf(row),
        barcodes: row.barcodes,
      })),
    };
  }
}
