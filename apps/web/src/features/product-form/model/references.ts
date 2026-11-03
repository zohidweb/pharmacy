'use client';

import { useQuery } from '@tanstack/react-query';
import { apiRequest } from '@/shared/api';

/** Values for the selects of the product card (categories, forms, units, countries…), cached for five minutes. */
export function useCatalogReferences() {
  return useQuery({
    queryKey: ['catalog', 'references'],
    queryFn: ({ signal }) => apiRequest('catalog.references', { signal }),
    staleTime: 5 * 60_000,
  });
}
