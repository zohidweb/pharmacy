import type { LicenseStatus } from '@pharmacy/shared-dto';
import type { ResolvedLicenseKey } from '../../core/database';

const DAY_MS = 86_400_000;

export interface LicenseState {
  status: LicenseStatus;
  /** Operations of the store are still accepted (ADR-0014 §7). */
  acceptsOperations: boolean;
  /** End of the grace period of a revoked, expired, closed or blocked license; null — no grace applies. */
  graceUntil: string | null;
  validUntil: string;
}

/**
 * The state of the license of an offline store (spec 2026-10-16-offline-sync, E12). The status, in this order:
 * revoked_hard → tenant_blocked → store_closed → revoked → expired → expiring → active. Revoked, expired, closed
 * and blocked licenses still accept operations for `graceDays` from the earliest of these events, so the sales
 * already made on the store are not lost. A later event (a revocation of an expired key, a block of the network)
 * never reopens a window that has closed, and an event without its time (a block outside the operator flow)
 * accepts nothing; revoked_hard accepts nothing.
 */
export function licenseState(
  key: ResolvedLicenseKey,
  now: Date,
  graceDays: number,
): LicenseState {
  const validUntil = key.validUntil.toISOString();
  const status = statusOf(key, now);
  if (status === 'revoked_hard') {
    return { status, acceptsOperations: false, graceUntil: null, validUntil };
  }
  if (status === 'active' || status === 'expiring') {
    return { status, acceptsOperations: true, graceUntil: null, validUntil };
  }
  const events: Array<Date | null> = [];
  if (key.tenantStatus !== 'active') events.push(key.tenantBlockedAt);
  if (key.storeStatus === 'closed') events.push(key.storeClosedAt);
  if (key.status === 'revoked') events.push(key.revokedAt);
  if (key.validUntil <= now) events.push(key.validUntil);
  const times = events.filter((at): at is Date => at !== null);
  if (times.length < events.length) {
    return { status, acceptsOperations: false, graceUntil: null, validUntil };
  }
  const until = new Date(
    Math.min(...times.map((at) => at.getTime())) + graceDays * DAY_MS,
  );
  return {
    status,
    acceptsOperations: now <= until,
    graceUntil: until.toISOString(),
    validUntil,
  };
}

function statusOf(key: ResolvedLicenseKey, now: Date): LicenseStatus {
  if (key.status === 'revoked_hard') return 'revoked_hard';
  if (key.tenantStatus !== 'active') return 'tenant_blocked';
  if (key.storeStatus === 'closed') return 'store_closed';
  if (key.status === 'revoked') return 'revoked';
  if (key.validUntil <= now) return 'expired';
  return key.validUntil.getTime() - now.getTime() <=
    key.notifyBeforeDays * DAY_MS
    ? 'expiring'
    : 'active';
}
