import type { TenantTransaction } from '../database';
import { SyncApplyError } from './fact-applier';

// Shared checks of the appliers of store facts (ADR-0014 §4 «валидация»; spec 2026-10-16-offline-sync, section
// 4.3): integer dirams, the store of the key, references to the network.

/** Integer dirams ≥ 0 (money is never a float). */
export const isMoney = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

/** A row of another store is never written from this key. */
export function sameStore(
  rowStoreId: string | null | undefined,
  storeId: string,
): void {
  if (rowStoreId !== storeId) throw new SyncApplyError('store_mismatch');
}

/** Employees of the network (cloud-owned, arrive with the feed): a missing one is a quarantine. */
export async function requireEmployees(
  trx: TenantTransaction,
  tenantId: string,
  ids: ReadonlyArray<string | null | undefined>,
): Promise<void> {
  const wanted = [
    ...new Set(ids.filter((id): id is string => typeof id === 'string')),
  ];
  if (wanted.length === 0) return;
  const rows = await trx
    .selectFrom('employees')
    .select('id')
    .where('tenantId', '=', tenantId)
    .where('id', 'in', wanted)
    .execute();
  if (rows.length !== wanted.length)
    throw new SyncApplyError('unknown_employee');
}

/** Products of the network (any status): a missing one is a quarantine. */
export async function requireProducts(
  trx: TenantTransaction,
  tenantId: string,
  ids: readonly string[],
): Promise<void> {
  const wanted = [...new Set(ids)];
  if (wanted.length === 0) return;
  const rows = await trx
    .selectFrom('products')
    .select('id')
    .where('tenantId', '=', tenantId)
    .where('id', 'in', wanted)
    .execute();
  if (rows.length !== wanted.length)
    throw new SyncApplyError('unknown_product');
}

/** A terminal of the store (a fact of the store): missing — wait for it. */
export async function requireTerminal(
  trx: TenantTransaction,
  tenantId: string,
  storeId: string,
  terminalId: string,
): Promise<void> {
  const row = await trx
    .selectFrom('terminals')
    .select('id')
    .where('tenantId', '=', tenantId)
    .where('storeId', '=', storeId)
    .where('id', '=', terminalId)
    .executeTakeFirst();
  if (!row) throw new SyncApplyError('terminal', 'dependency');
}
