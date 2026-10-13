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

/**
 * Saved lines → editable lines. The batch of a line stays selectable even with no stock left: when
 * the stock list no longer has it (it went out whole), it is taken from the line itself.
 */
export function toEditableLines(
  lines: Array<StockLine & { note?: string }>,
  byId: ReadonlyMap<string, StockProductOption>,
): EditableStockLine[] {
  return lines.map((line, index) => {
    const product = byId.get(line.productId);
    const piecesPerPack = product?.piecesPerPack ?? 1;
    const inStock =
      product?.batches.filter(
        (b) => b.quantityPieces > 0 || b.id === line.batchId,
      ) ?? [];
    const batches = inStock.some((b) => b.id === line.batchId)
      ? inStock
      : [
          ...inStock,
          {
            id: line.batchId,
            number: line.batchNumber,
            expiresOn: line.expiresOn,
            quantityPieces: 0,
            // a batch keeps the price of a pack; a piece line carries the price of a piece
            ...(line.costMinor !== undefined
              ? {
                  costMinor:
                    line.unit === 'pack'
                      ? line.costMinor
                      : line.costMinor * piecesPerPack,
                }
              : {}),
          },
        ];
    return {
      key: `${line.productId}-${line.batchId}-${index}`,
      productId: line.productId,
      productName: line.productName,
      piecesPerPack,
      divisible: product?.divisible ?? false,
      batches,
      batchId: line.batchId,
      unit: line.unit,
      quantity: line.quantity,
      note: line.note ?? '',
    };
  });
}
