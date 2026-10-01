import type { TenantListQuery } from '@pharmacy/shared-dto';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { apiRequest } from '@/shared/api';

export const tenantKeys = {
  all: ['tenants'] as const,
  list: (query: TenantListQuery) => ['tenants', 'list', query] as const,
  detail: (id: string) => ['tenants', 'detail', id] as const,
  tab: (
    id: string,
    tab: 'stores' | 'invoices' | 'payments' | 'services' | 'stats' | 'audit',
    extra?: unknown,
  ) => ['tenants', 'detail', id, tab, extra] as const,
};

export function useTenantList(query: TenantListQuery) {
  return useQuery({
    queryKey: tenantKeys.list(query),
    queryFn: ({ signal }) => apiRequest('tenants.list', { query, signal }),
    placeholderData: keepPreviousData,
  });
}

export function useTenant(id: string) {
  return useQuery({
    queryKey: tenantKeys.detail(id),
    queryFn: ({ signal }) =>
      apiRequest('tenants.get', { params: { id }, signal }),
    enabled: id !== '',
  });
}

export function useTenantStores(id: string) {
  return useQuery({
    queryKey: tenantKeys.tab(id, 'stores'),
    queryFn: ({ signal }) =>
      apiRequest('tenants.stores', { params: { id }, signal }),
  });
}

export function useTenantInvoices(id: string) {
  return useQuery({
    queryKey: tenantKeys.tab(id, 'invoices'),
    queryFn: ({ signal }) =>
      apiRequest('tenants.invoices', { params: { id }, signal }),
  });
}

export function useTenantPayments(id: string) {
  return useQuery({
    queryKey: tenantKeys.tab(id, 'payments'),
    queryFn: ({ signal }) =>
      apiRequest('tenants.payments', { params: { id }, signal }),
  });
}

export function useTenantServices(id: string) {
  return useQuery({
    queryKey: tenantKeys.tab(id, 'services'),
    queryFn: ({ signal }) =>
      apiRequest('tenants.services', { params: { id }, signal }),
  });
}

export function useTenantStats(id: string) {
  return useQuery({
    queryKey: tenantKeys.tab(id, 'stats'),
    queryFn: ({ signal }) =>
      apiRequest('tenants.stats', { params: { id }, signal }),
  });
}

export function useTenantAudit(
  id: string,
  page: { limit: number; offset: number },
) {
  return useQuery({
    queryKey: tenantKeys.tab(id, 'audit', page),
    queryFn: ({ signal }) =>
      apiRequest('tenants.audit', { params: { id }, query: page, signal }),
    placeholderData: keepPreviousData,
  });
}
