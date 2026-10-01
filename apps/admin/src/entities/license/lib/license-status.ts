import type { LicenseListItem } from '@pharmacy/shared-dto';
import { daysBetween } from '@pharmacy/shared-util';
import type { StatusTone } from '@pharmacy/ui';

export type LicenseStatusKey = 'active' | 'expiring' | 'expired' | 'revoked';

/** Revoked is stored; expired and expiring are derived from the expiry and the notice window. */
export function licenseStatusKey(
  license: Pick<LicenseListItem, 'state' | 'validUntil' | 'notifyDaysBefore'>,
  today: string,
): LicenseStatusKey {
  if (license.state === 'revoked') return 'revoked';
  const left = daysBetween(today, license.validUntil);
  if (left < 0) return 'expired';
  return left <= license.notifyDaysBefore ? 'expiring' : 'active';
}

export const licenseStatusTone: Record<LicenseStatusKey, StatusTone> = {
  active: 'success',
  expiring: 'warning',
  expired: 'danger',
  revoked: 'danger',
};

export function daysLeft(validUntil: string, today: string): number {
  return daysBetween(today, validUntil);
}
