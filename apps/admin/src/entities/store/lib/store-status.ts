import type { StoreSummary } from '@pharmacy/shared-dto';
import { daysBetween, toAppDate } from '@pharmacy/shared-util';
import type { StatusTone } from '@pharmacy/ui';

/** Default warning window before a license key expires (platform setting, ADR-0013 operator side). */
export const KEY_EXPIRY_NOTICE_DAYS = 7;
/** An offline store without a successful sync for this many days needs attention. */
export const SYNC_STALE_DAYS = 3;

export type StoreStatusKey =
  'active' | 'closed' | 'keyExpired' | 'keyExpiring' | 'noSync';

/**
 * Display status of a store: the glossary status (active / closed) plus attention flags of
 * offline stores derived from the license expiry and the last sync. `today` is YYYY-MM-DD.
 */
export function storeStatusKey(
  store: Pick<
    StoreSummary,
    'status' | 'mode' | 'licenseValidUntil' | 'lastSyncAt'
  >,
  today: string,
  noticeDays = KEY_EXPIRY_NOTICE_DAYS,
): StoreStatusKey {
  if (store.status === 'closed') return 'closed';
  if (store.mode === 'offline') {
    if (store.licenseValidUntil) {
      const left = daysBetween(today, store.licenseValidUntil);
      if (left < 0) return 'keyExpired';
      if (left <= noticeDays) return 'keyExpiring';
    }
    if (
      !store.lastSyncAt ||
      daysBetween(toAppDate(new Date(store.lastSyncAt)), today) >=
        SYNC_STALE_DAYS
    ) {
      return 'noSync';
    }
  }
  return 'active';
}

export const storeStatusTone: Record<StoreStatusKey, StatusTone> = {
  active: 'success',
  closed: 'neutral',
  keyExpired: 'danger',
  keyExpiring: 'warning',
  noSync: 'danger',
};
