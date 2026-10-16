import type { InvoiceListQuery, PaymentListQuery } from '@pharmacy/shared-dto';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { apiRequest } from '@/shared/api';

export const billingKeys = {
  all: ['billing'] as const,
  summary: (period: string) => ['billing', 'summary', period] as const,
  invoices: (query: InvoiceListQuery) =>
    ['billing', 'invoices', query] as const,
  invoice: (id: string) => ['billing', 'invoice', id] as const,
  payments: (query: PaymentListQuery) =>
    ['billing', 'payments', query] as const,
};

export function useInvoices(query: InvoiceListQuery, enabled = true) {
  return useQuery({
    queryKey: billingKeys.invoices(query),
    queryFn: ({ signal }) => apiRequest('invoices.list', { query, signal }),
    placeholderData: keepPreviousData,
    enabled,
  });
}
