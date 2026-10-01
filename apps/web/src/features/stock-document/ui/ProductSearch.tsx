'use client';

import type { StockProductOption } from '@pharmacy/shared-dto';
import { formatMoney } from '@pharmacy/shared-util';
import { Spinner, TextField } from '@pharmacy/ui';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslations } from 'use-intl';
import { apiRequest } from '@/shared/api';
import { useBarcodeScanner } from '@/shared/lib/scanner';

/**
 * Adds a product to a document line: search by name, МНН or barcode, or a scan (the scanner works
 * without focusing the field). Results come from the stock of the store (`stock-products`).
 */
export function ProductSearch({
  storeId,
  onPick,
  disabled = false,
}: {
  storeId: string;
  onPick: (product: StockProductOption) => void;
  disabled?: boolean;
}) {
  const t = useTranslations('stockDocs.search');
  const [query, setQuery] = useState('');
  const trimmed = query.trim();
  const results = useQuery({
    queryKey: ['stock-products', storeId, trimmed],
    queryFn: ({ signal }) =>
      apiRequest('stock.products', {
        params: { storeId },
        query: { query: trimmed, limit: 8 },
        signal,
      }),
    enabled: trimmed.length >= 2 && !disabled,
  });

  useBarcodeScanner(
    async (code) => {
      const found = await apiRequest('stock.products', {
        params: { storeId },
        query: { query: code, limit: 1 },
      });
      if (found[0]) onPick(found[0]);
      else setQuery(code);
    },
    { enabled: !disabled },
  );

  return (
    <div className="relative flex flex-col gap-1">
      <TextField
        label={t('label')}
        hideLabel
        type="search"
        placeholder={t('placeholder')}
        autoComplete="off"
        disabled={disabled}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      {trimmed.length >= 2 && (
        <div className="rounded-md border border-border bg-surface shadow-md">
          {results.isPending ? (
            <div className="grid place-items-center p-3 text-primary">
              <Spinner size="md" label={t('loading')} />
            </div>
          ) : results.data && results.data.length > 0 ? (
            <ul
              aria-label={t('results')}
              className="m-0 flex list-none flex-col p-0"
            >
              {results.data.map((product) => (
                <li key={product.id}>
                  <button
                    type="button"
                    onClick={() => {
                      onPick(product);
                      setQuery('');
                    }}
                    className="flex min-h-touch w-full items-center justify-between gap-3 px-3 py-2 text-start text-sm hover:bg-surface-sunken"
                  >
                    <span className="font-medium">{product.name}</span>
                    <span className="text-xs text-fg-subtle">
                      {formatMoney(product.retailPriceMinor)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="p-3 text-sm text-fg-subtle">{t('nothing')}</p>
          )}
        </div>
      )}
    </div>
  );
}
