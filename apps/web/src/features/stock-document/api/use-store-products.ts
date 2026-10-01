'use client';

import type { StockLine, StockProductOption } from '@pharmacy/shared-dto';
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { apiRequest } from '@/shared/api';
import type { EditableStockLine } from '../ui/StockLinesEditor';

/** Products of a store with their batches and stock — to open saved document lines for editing. */
export function useStoreProducts(storeId: string) {
  const query = useQuery({
    queryKey: ['stock-products', storeId, 'all'],
    queryFn: ({ signal }) =>
      apiRequest('stock.products', {
        params: { storeId },
        query: { limit: 500 },
        signal,
      }),
    enabled: Boolean(storeId),
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

/** Saved lines → editable lines (the batch stays selectable even with no stock left). */
export function toEditableLines(
  lines: Array<StockLine & { note?: string }>,
  byId: ReadonlyMap<string, StockProductOption>,
): EditableStockLine[] {
  return lines.map((line, index) => {
    const product = byId.get(line.productId);
    const batches =
      product?.batches.filter(
        (b) => b.quantityPieces > 0 || b.id === line.batchId,
      ) ?? [];
    return {
      key: `${line.productId}-${line.batchId}-${index}`,
      productId: line.productId,
      productName: line.productName,
      piecesPerPack: product?.piecesPerPack ?? 1,
      divisible: product?.divisible ?? false,
      batches,
      batchId: line.batchId,
      unit: line.unit,
      quantity: line.quantity,
      note: line.note ?? '',
    };
  });
}
