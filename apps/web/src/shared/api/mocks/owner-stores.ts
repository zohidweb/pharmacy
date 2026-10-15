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
  const { closingTransferIds = [], ...details } = stored;
  const closingTransfers = closingTransfersOf(closingTransferIds);
  return {
    id: base.id,
    name: base.name,
    address: base.address,
    mode: base.mode,
    legalEntityName: legalEntityName(details.legalEntityId),
    receiptsThisMonth: (storeDay[id]?.receipts ?? 0) * dayOfMonth(),
    ...details,
    closingTransfers,
    closingCancellable:
      details.status === 'closing' &&
      closingTransfers.every((t) => t.status === 'in_transit'),
  };
}

/** The closing transfers of a store as the API shows them: not cancelled, accepted or in transit. */
export function closingTransfersOf(ids: readonly string[]) {
  return mockDb()
    .stock.transfers.filter((t) => ids.includes(t.id))
    .filter((t) => t.status === 'in_transit' || t.status === 'accepted')
    .map((t) => ({
      number: t.number,
      status: t.status as 'in_transit' | 'accepted',
    }));
}

export function legalEntityName(id: string): string {
  return owner().legalEntities.find((e) => e.id === id)?.name ?? '—';
}

/**
 * Called when a transfer is accepted: a closing store none of whose closing transfers is still in
 * transit is closed (spec 2026-10-15-store-closing, E11).
 */
export function completeStoreClosing(transferId: string) {
  const entry = Object.entries(owner().storeDetails).find(([, details]) =>
    details.closingTransferIds?.includes(transferId),
  );
  if (!entry) return;
  const [storeId, details] = entry;
  const inTransit = mockDb().stock.transfers.some(
    (t) =>
      details.closingTransferIds?.includes(t.id) && t.status === 'in_transit',
  );
  if (!inTransit) closeStore(storeId);
}

/** The store leaves the working lists: closed today. */
export function closeStore(storeId: string) {
  const details = owner().storeDetails[storeId];
  const closed = ownerStore(storeId);
  if (!details || !closed) return;
  owner().extraStores.push({
    ...closed,
    status: 'closed',
    closedOn: toAppDate(),
    closingCancellable: false,
  });
  stores.splice(
    stores.findIndex((s) => s.id === storeId),
    1,
  );
  delete owner().storeDetails[storeId];
}
