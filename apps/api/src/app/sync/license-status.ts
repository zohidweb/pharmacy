import type { LicenseStatus } from '@pharmacy/shared-dto';
import type { ResolvedLicenseKey } from '../../core/database';

const DAY_MS = 86_400_000;

export interface LicenseState {
  status: LicenseStatus;
  /** Operations of the store are still accepted (ADR-0014 §7). */
  acceptsOperations: boolean;
  /** End of the grace period of a revoked, expired or closed license; null — no grace applies. */
  graceUntil: string | null;
  validUntil: string;
}

/**
 * The state of the license of an offline store (spec 2026-10-16-offline-sync, E12), in this order:
 * revoked_hard → tenant_blocked → store_closed → revoked → expired → expiring → active. Revoked, expired,
 * closed and blocked licenses still accept operations for `graceDays` from their event, so the sales already
 * made on the store are not lost; revoked_hard accepts nothing.
 */
export function licenseState(
  key: ResolvedLicenseKey,
  now: Date,
  graceDays: number,
): LicenseState {
  const validUntil = key.validUntil.toISOString();
  const grace = (
    from: Date | null,
  ): Pick<LicenseState, 'acceptsOperations' | 'graceUntil'> => {
    // Without an event time (a blocked network) the grace runs from now: operations are accepted.
    const until = new Date((from ?? now).getTime() + graceDays * DAY_MS);
    return { acceptsOperations: now <= until, graceUntil: until.toISOString() };
  };

  if (key.status === 'revoked_hard') {
    return {
      status: 'revoked_hard',
      acceptsOperations: false,
      graceUntil: null,
      validUntil,
    };
  }
  if (key.tenantStatus !== 'active') {
    return { status: 'tenant_blocked', ...grace(null), validUntil };
  }
  if (key.storeStatus === 'closed') {
    return { status: 'store_closed', ...grace(key.storeClosedAt), validUntil };
  }
  if (key.status === 'revoked') {
    return { status: 'revoked', ...grace(key.revokedAt), validUntil };
  }
  if (key.validUntil <= now) {
    return { status: 'expired', ...grace(key.validUntil), validUntil };
  }
  const expiring =
    key.validUntil.getTime() - now.getTime() <= key.notifyBeforeDays * DAY_MS;
  return {
    status: expiring ? 'expiring' : 'active',
    acceptsOperations: true,
    graceUntil: null,
    validUntil,
  };
}
