import { Injectable } from '@nestjs/common';
import type { LegalEntity, LegalEntityInput, StoreKind } from '@pharmacy/shared-dto';
import { sql } from 'kysely';
import type { TenantTransaction } from '../../core/database';

/** A store row with the name of its legal entity. */
export interface StoreRow {
  id: string;
  name: string;
  code: string;
  address: string;
  kind: string;
  mode: string;
  status: string;
  legalEntityId: string;
  legalEntityName: string;
  printReceiptDefault: boolean;
  closedAt: Date | null;
}

export interface NewStore {
  tenantId: string;
  id: string;
  legalEntityId: string;
  name: string;
  code: string;
  address: string;
  kind: StoreKind;
  printReceiptDefault: boolean;
  idempotencyKey: string | null;
}

export interface StoreChange {
  name: string;
  address: string;
  legalEntityId: string;
  printReceiptDefault: boolean;
}

// Data access of the owner's stores and legal entities (spec 2026-10-06-owner-stores). Every query
// runs in a tenant transaction: RLS limits it to the request's network, and tenant_id is still part
// of every filter and composite key (ADR-0002).
@Injectable()
export class StoresRepository {
  private storeQuery(trx: TenantTransaction, tenantId: string) {
    return trx
      .selectFrom('stores')
      .innerJoin('legalEntities', (join) =>
        join
          .onRef('legalEntities.tenantId', '=', 'stores.tenantId')
          .onRef('legalEntities.id', '=', 'stores.legalEntityId'),
      )
      .select([
        'stores.id',
        'stores.name',
        'stores.code',
        'stores.address',
        'stores.kind',
        'stores.mode',
        'stores.status',
        'stores.legalEntityId',
        'legalEntities.name as legalEntityName',
        'stores.printReceiptDefault',
        'stores.closedAt',
      ])
      .where('stores.tenantId', '=', tenantId);
  }

  /** Stores of a scope (`'all'` — the whole network), active first, then by name. */
  async listStores(
    trx: TenantTransaction,
    tenantId: string,
    scope: 'all' | readonly string[],
  ): Promise<StoreRow[]> {
    if (scope !== 'all' && scope.length === 0) return [];
    let query = this.storeQuery(trx, tenantId);
    if (scope !== 'all') query = query.where('stores.id', 'in', [...scope]);
    return query
      .orderBy(sql`stores.status = 'active'`, 'desc')
      .orderBy('stores.name')
      .orderBy('stores.id')
      .execute();
  }

  async findStore(
    trx: TenantTransaction,
    tenantId: string,
    id: string,
  ): Promise<StoreRow | null> {
    return (
      (await this.storeQuery(trx, tenantId)
        .where('stores.id', '=', id)
        .executeTakeFirst()) ?? null
    );
  }

  async findStoreByKey(
    trx: TenantTransaction,
    tenantId: string,
    idempotencyKey: string,
  ): Promise<StoreRow | null> {
    return (
      (await this.storeQuery(trx, tenantId)
        .where('stores.idempotencyKey', '=', idempotencyKey)
        .executeTakeFirst()) ?? null
    );
  }

  async insertStore(trx: TenantTransaction, store: NewStore): Promise<void> {
    await trx
      .insertInto('stores')
      .values({ ...store, mode: 'online', status: 'active' })
      .execute();
  }

  async updateStore(
    trx: TenantTransaction,
    tenantId: string,
    id: string,
    change: StoreChange,
  ): Promise<void> {
    await trx
      .updateTable('stores')
      .set({ ...change, updatedAt: sql`now()` })
      .where('tenantId', '=', tenantId)
      .where('id', '=', id)
      .execute();
  }

  private legalEntityQuery(trx: TenantTransaction, tenantId: string) {
    return trx
      .selectFrom('legalEntities')
      .select((eb) => [
        'legalEntities.id',
        'legalEntities.name',
        'legalEntities.taxId',
        'legalEntities.legalAddress',
        'legalEntities.phone',
        'legalEntities.email',
        'legalEntities.bankDetails',
        eb
          .selectFrom('stores')
          .select((inner) => inner.fn.countAll<string>().as('count'))
          .whereRef('stores.tenantId', '=', 'legalEntities.tenantId')
          .whereRef('stores.legalEntityId', '=', 'legalEntities.id')
          .as('stores'),
      ])
      .where('legalEntities.tenantId', '=', tenantId)
      .where('legalEntities.status', '=', 'active');
  }

  /** Active legal entities of the network, by name. */
  async listLegalEntities(
    trx: TenantTransaction,
    tenantId: string,
  ): Promise<LegalEntity[]> {
    const rows = await this.legalEntityQuery(trx, tenantId)
      .orderBy('legalEntities.name')
      .orderBy('legalEntities.id')
      .execute();
    return rows.map(toLegalEntity);
  }

  /** An active legal entity of the network. */
  async findLegalEntity(
    trx: TenantTransaction,
    tenantId: string,
    id: string,
  ): Promise<LegalEntity | null> {
    const row = await this.legalEntityQuery(trx, tenantId)
      .where('legalEntities.id', '=', id)
      .executeTakeFirst();
    return row ? toLegalEntity(row) : null;
  }

  async insertLegalEntity(
    trx: TenantTransaction,
    tenantId: string,
    id: string,
    input: LegalEntityInput,
  ): Promise<void> {
    await trx
      .insertInto('legalEntities')
      .values({
        tenantId,
        id,
        name: input.name,
        taxId: input.taxId,
        legalAddress: input.legalAddress,
        phone: input.phone ?? null,
        email: input.email ?? null,
        bankDetails: input.bankDetails ?? null,
      })
      .execute();
  }

  async updateLegalEntity(
    trx: TenantTransaction,
    tenantId: string,
    id: string,
    change: Partial<LegalEntityInput>,
  ): Promise<void> {
    await trx
      .updateTable('legalEntities')
      .set({ ...change, updatedAt: sql`now()` })
      .where('tenantId', '=', tenantId)
      .where('id', '=', id)
      .execute();
  }

  /** The network's own name and INN (pharmacy_app reads its own tenants row). */
  async networkDefaults(
    trx: TenantTransaction,
    tenantId: string,
  ): Promise<{ name: string; taxId: string | null }> {
    const row = await trx
      .selectFrom('tenants')
      .select(['name', 'billingTaxId'])
      .where('id', '=', tenantId)
      .executeTakeFirstOrThrow();
    return { name: row.name, taxId: row.billingTaxId };
  }
}

function toLegalEntity(row: {
  id: string;
  name: string;
  taxId: string;
  legalAddress: string;
  phone: string | null;
  email: string | null;
  bankDetails: string | null;
  stores: string | number | bigint | null;
}): LegalEntity {
  return { ...row, stores: Number(row.stores ?? 0) };
}
