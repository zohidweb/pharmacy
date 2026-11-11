import { useQuery } from '@tanstack/react-query';
import { apiRequest } from '@/shared/api';

/** Results shown under the field (plan 2026-11-11-drug-reference-seed, R11). */
export const DRUG_REFERENCE_LIMIT = 8;

/** The platform drug reference for a query of at least 2 characters (8–14 digits — a barcode). */
export function useDrugReferenceSearch(query: string) {
  const q = query.trim();
  return useQuery({
    queryKey: ['drug-references', q],
    queryFn: () =>
      apiRequest('catalog.drugReferences', {
        query: { q, limit: DRUG_REFERENCE_LIMIT },
      }),
    enabled: q.length >= 2,
    // the reference changes rarely: a repeated query within minutes comes from the cache
    staleTime: 5 * 60_000,
  });
}
