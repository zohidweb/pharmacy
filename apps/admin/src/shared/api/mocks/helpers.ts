/* Shared helpers of the mock handlers. */
import type { StoreDetails, TenantDetails } from '@pharmacy/shared-dto';
import { ApiError } from '../client';
import { mockDb } from './db';
import { demoOperator } from './fixtures';

export const notFound = (correlationId: string) =>
  new ApiError(404, 'not_found', correlationId);

export function findTenant(id: string, correlationId: string): TenantDetails {
  const tenant = mockDb().tenants.find((t) => t.id === id);
  if (!tenant) throw notFound(correlationId);
  return tenant;
}

export function findStore(id: string, correlationId: string): StoreDetails {
  const found = mockDb().stores.find((s) => s.id === id);
  if (!found) throw notFound(correlationId);
  return found;
}

export function audit(
  tenantId: string,
  action: string,
  storeName: string | null = null,
) {
  const entries = (mockDb().audit[tenantId] ??= []);
  entries.unshift({
    id: `a-${Date.now()}`,
    at: new Date().toISOString(),
    actorName: demoOperator.fullName,
    actorIsPlatformOperator: true,
    storeName,
    action,
  });
}
