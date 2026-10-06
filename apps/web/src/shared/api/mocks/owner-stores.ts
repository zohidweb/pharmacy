/*
 * Stores as the owner sees them (session store + details) and the end of a store closing: when the
 * receiver accepts the transfer of its stock, the store is closed (ТЗ «Кабинет владельца»).
 */
import type { OwnerStore } from '@pharmacy/shared-dto';
import { toAppDate } from '@pharmacy/shared-util';
import { mockDb } from './db';
import { storeDay, stores } from './fixtures';

const owner = () => mockDb().owner;
const dayOfMonth = () => Number(toAppDate().slice(8, 10));

export function ownerStore(id: string): OwnerStore | null {
  const base = stores.find((s) => s.id === id);
  if (!base) return owner().extraStores.find((s) => s.id === id) ?? null;
  const stored = owner().storeDetails[id];
  if (!stored) return null;
  const { closingTransferId: _transfer, ...details } = stored;
  return {
    id: base.id,
    name: base.name,
    address: base.address,
    mode: base.mode,
    legalEntityName: legalEntityName(details.legalEntityId),
    receiptsThisMonth: (storeDay[id]?.receipts ?? 0) * dayOfMonth(),
    ...details,
  };
}

export function legalEntityName(id: string): string {
  return owner().legalEntities.find((e) => e.id === id)?.name ?? '—';
}

/** Called when a transfer is accepted: a closing store whose stock left completes its closing. */
export function completeStoreClosing(transferId: string) {
  const entry = Object.entries(owner().storeDetails).find(
    ([, details]) => details.closingTransferId === transferId,
  );
  if (!entry) return;
  const [storeId, details] = entry;
  const closed = ownerStore(storeId);
  if (!closed) return;
  details.status = 'closed';
  owner().extraStores.push({ ...closed, status: 'closed' });
  stores.splice(
    stores.findIndex((s) => s.id === storeId),
    1,
  );
  delete owner().storeDetails[storeId];
}
