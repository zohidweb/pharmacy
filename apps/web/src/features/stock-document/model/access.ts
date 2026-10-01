'use client';

/*
 * What the employee may do with stock documents (ADR-0018 + ADR-0014): the role permissions, the
 * view-only impersonation, and the offline store whose stock the cloud only reads. The server
 * decides; this only hides and disables controls.
 */
import { can, canWrite, useSession } from '@/entities/session';

export interface StockAccess {
  canCreate: boolean;
  canUpdate: boolean;
  canPost: boolean;
  canUnpost: boolean;
  canReceive: boolean;
  canSeeCost: boolean;
  /** Why documents of the store are read-only, or null. */
  readOnly: 'role' | 'offline' | 'impersonation' | null;
  /** Stores where documents may be written (cloud stores of the scope). */
  writableStores: Array<{ id: string; name: string }>;
}

export function useStockAccess(storeId?: string | null): StockAccess {
  const { data: session } = useSession();
  const stores = session?.stores ?? [];
  const store = stores.find(
    (s) => s.id === (storeId ?? session?.currentStoreId),
  );
  const readOnly = session?.impersonation
    ? 'impersonation'
    : !can(session, 'inventory:create')
      ? 'role'
      : store?.mode === 'offline'
        ? 'offline'
        : null;
  const write = (permission: Parameters<typeof canWrite>[1]) =>
    canWrite(session, permission) && readOnly === null;
  return {
    canCreate: write('inventory:create'),
    canUpdate: write('inventory:update'),
    canPost: write('inventory:post'),
    canUnpost: write('inventory:unpost'),
    canReceive:
      canWrite(session, 'inventory:receive') && readOnly !== 'offline',
    canSeeCost: can(session, 'finance:view-cost'),
    readOnly,
    writableStores: stores
      .filter((s) => s.mode === 'cloud')
      .map((s) => ({ id: s.id, name: s.name })),
  };
}
