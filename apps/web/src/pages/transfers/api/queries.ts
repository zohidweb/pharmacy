'use client';

import type { StockProductOption } from '@pharmacy/shared-dto';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import { apiRequest } from '@/shared/api';

const keys = [['transfers'], ['stock'], ['stock-products'], ['write-offs']];

/** Transfers, stock and write-offs change together: a dispatch, a recall or an acceptance. */
export function useInvalidateTransfers() {
  const queryClient = useQueryClient();
  return () =>
    Promise.all(
      keys.map((queryKey) => queryClient.invalidateQueries({ queryKey })),
    );
}

/**
 * Exactly these products of a store with their batches in stock (archived ones too), whatever the
 * page of the store list — to show and edit the lines of a request or a transfer.
 */
export function useProductsByIds(storeId: string, ids: readonly string[]) {
  const sorted = [...new Set(ids)].sort();
  const query = useQuery({
    queryKey: ['stock-products', storeId, 'ids', sorted.join(',')],
    queryFn: ({ signal }) =>
      apiRequest('stock.products', {
        params: { storeId },
        query: { ids: sorted.join(',') },
        signal,
      }),
    enabled: Boolean(storeId) && sorted.length > 0,
  });
  const byId = useMemo(
    () =>
      new Map<string, StockProductOption>(
        (query.data ?? []).map((p) => [p.id, p]),
      ),
    [query.data],
  );
  return { ...query, byId };
}
