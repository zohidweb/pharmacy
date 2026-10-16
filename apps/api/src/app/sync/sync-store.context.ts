import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { LicenseState } from './license-status';

/** The offline store a sync request comes from, set by LicenseKeyGuard (spec 2026-10-16-offline-sync, E10). */
export interface SyncStore {
  tenantId: string;
  storeId: string;
  keyId: string;
  /** Mode of the store when the key was checked: online, offline_pending or offline. */
  storeMode: string;
  license: LicenseState;
  /** Platform settings the run needs (E13). */
  settings: SyncSettings;
}

export interface SyncSettings {
  feedWindowDays: number;
  revokedKeyGraceDays: number;
  minSupportedProtocol: number;
  recommendedProtocol: number;
}

export interface SyncRequest {
  syncStore?: SyncStore;
}

/** The SyncStore of the request; the route must be guarded by LicenseKeyGuard. */
export const SyncStoreParam = createParamDecorator(
  (_data: unknown, context: ExecutionContext): SyncStore => {
    const store = context.switchToHttp().getRequest<SyncRequest>().syncStore;
    if (!store) throw new Error('SyncStoreParam outside LicenseKeyGuard');
    return store;
  },
);
