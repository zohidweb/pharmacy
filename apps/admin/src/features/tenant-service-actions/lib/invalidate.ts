import type { QueryClient } from '@tanstack/react-query';
import { attentionKeys } from '@/entities/event';
import { tenantKeys } from '@/entities/tenant';

export const serviceKeys = {
  catalog: ['services'] as const,
  requests: ['service-requests'] as const,
  tenantServices: ['tenant-services'] as const,
};

/**
 * After a decision or a change of a network's service: the requests, the lists of services, the
 * network's tab, the counts of the catalog and the menu counter.
 */
export function invalidateServices(
  queryClient: QueryClient,
  tenantId: string,
): void {
  for (const queryKey of [
    serviceKeys.catalog,
    serviceKeys.requests,
    serviceKeys.tenantServices,
    tenantKeys.tab(tenantId, 'services'),
    attentionKeys.counts,
  ]) {
    void queryClient.invalidateQueries({ queryKey });
  }
}
