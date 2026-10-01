import type { StatusTone } from '@pharmacy/ui';
import type { TenantListItem } from '@pharmacy/shared-dto';

export type TenantStatusKey = 'active' | 'unpaid' | 'blocked';

/** Display status: blocking wins over debt; debt is shown only for active tenants. */
export function tenantStatusKey(
  tenant: Pick<TenantListItem, 'status' | 'overdue'>,
): TenantStatusKey {
  if (tenant.status === 'blocked') return 'blocked';
  return tenant.overdue ? 'unpaid' : 'active';
}

export const tenantStatusTone: Record<TenantStatusKey, StatusTone> = {
  active: 'success',
  unpaid: 'danger',
  blocked: 'neutral',
};
