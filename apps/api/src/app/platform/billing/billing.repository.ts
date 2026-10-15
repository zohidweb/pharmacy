import { Injectable } from '@nestjs/common';
import type {
  PlatformService,
  PlatformSettings,
  UpsertServiceRequest,
} from '@pharmacy/shared-dto';
import { sql, type Transaction } from 'kysely';
import type { DB } from '../../../core/database';

/** A text of a `{ru, tj}` map; null when the language is absent. */
export function textOf(map: unknown, key: 'ru' | 'tj'): string | null {
  if (map === null || typeof map !== 'object') return null;
  const value = (map as Record<string, unknown>)[key];
  return typeof value === 'string' ? value : null;
}

const textMap = (ru: string, tj: string | null): string =>
  JSON.stringify(tj === null ? { ru } : { ru, tj });

interface ServiceRow {
  id: string;
  name: unknown;
  description: unknown;
  basePriceDirams: bigint | string | number;
  visible: boolean;
  archived: boolean;
  tenants: bigint | string | number | null;
}

const toService = (row: ServiceRow): PlatformService => ({
  id: row.id,
  nameRu: textOf(row.name, 'ru') ?? '',
  nameTj: textOf(row.name, 'tj'),
  descriptionRu: textOf(row.description, 'ru') ?? '',
  descriptionTj: textOf(row.description, 'tj'),
  basePriceMinor: Number(row.basePriceDirams),
  visible: row.visible,
  archived: row.archived,
  tenants: Number(row.tenants ?? 0),
});

// The platform side of billing (spec 2026-10-15-billing-services, sections 4 and 6.1): the settings
// and the service catalog, in the caller's platform transaction (role pharmacy_platform). Money is
// bigint dirams in the database, a number of dirams in the contract.
@Injectable()
export class BillingRepository {
  async settings(trx: Transaction<DB>): Promise<PlatformSettings> {
    const row = await trx
      .selectFrom('platformSettings')
      .selectAll()
      .where('id', '=', 1)
      .executeTakeFirstOrThrow();
    return {
      pricePerStoreMinor: Number(row.storeMonthlyPriceDirams),
      vatRatePercent: row.vatBp / 100,
      supplier: {
        name: row.supplierName,
        inn: row.supplierInn,
        bankAccount: row.supplierBankAccount,
        bankName: row.supplierBankName,
        bankBik: row.supplierBankBik,
        bankCorrAccount: row.supplierBankCorrAccount,
        paymentPurposeTemplate: row.paymentPurposeTemplate,
      },
    };
  }

  async updateSettings(
    trx: Transaction<DB>,
    next: PlatformSettings,
    operatorId: string,
  ): Promise<void> {
    await trx
      .updateTable('platformSettings')
      .set({
        storeMonthlyPriceDirams: BigInt(next.pricePerStoreMinor),
        vatBp: next.vatRatePercent * 100,
        supplierName: next.supplier.name,
        supplierInn: next.supplier.inn,
        supplierBankAccount: next.supplier.bankAccount,
        supplierBankName: next.supplier.bankName,
        supplierBankBik: next.supplier.bankBik,
        supplierBankCorrAccount: next.supplier.bankCorrAccount,
        paymentPurposeTemplate: next.supplier.paymentPurposeTemplate,
        updatedAt: sql<Date>`now()`,
        updatedBy: operatorId,
      })
      .where('id', '=', 1)
      .execute();
  }

  /** The catalog: archived services last, then by the Russian name. */
  async services(
    trx: Transaction<DB>,
    serviceId?: string,
  ): Promise<PlatformService[]> {
    let query = trx
      .selectFrom('services as s')
      .select([
        's.id',
        's.name',
        's.description',
        's.basePriceDirams',
        's.visible',
        's.archived',
        (eb) =>
          eb
            .selectFrom('tenantServices as ts')
            .select(sql<string>`count(distinct ts.tenant_id)`.as('n'))
            .whereRef('ts.serviceId', '=', 's.id')
            .where('ts.status', 'in', ['approved', 'provided'])
            .as('tenants'),
      ])
      .orderBy('s.archived')
      .orderBy(sql`lower(s.name ->> 'ru')`)
      .orderBy('s.id');
    if (serviceId !== undefined) query = query.where('s.id', '=', serviceId);
    const rows = await query.execute();
    return rows.map(toService);
  }

  async insertService(
    trx: Transaction<DB>,
    id: string,
    service: UpsertServiceRequest,
  ): Promise<void> {
    await trx
      .insertInto('services')
      .values({
        id,
        name: textMap(service.nameRu, service.nameTj),
        description: textMap(service.descriptionRu, service.descriptionTj),
        basePriceDirams: BigInt(service.basePriceMinor),
        visible: service.visible,
        archived: service.archived,
      })
      .execute();
  }

  /** False for an unknown service. */
  async updateService(
    trx: Transaction<DB>,
    id: string,
    service: UpsertServiceRequest,
  ): Promise<boolean> {
    const result = await trx
      .updateTable('services')
      .set({
        name: textMap(service.nameRu, service.nameTj),
        description: textMap(service.descriptionRu, service.descriptionTj),
        basePriceDirams: BigInt(service.basePriceMinor),
        visible: service.visible,
        archived: service.archived,
        updatedAt: sql<Date>`now()`,
      })
      .where('id', '=', id)
      .executeTakeFirst();
    return result.numUpdatedRows > 0n;
  }
}
