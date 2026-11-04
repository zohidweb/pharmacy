'use client';

import type { StockProductOption } from '@pharmacy/shared-dto';
import { formatMoney } from '@pharmacy/shared-util';
import { Button, Spinner, TextField } from '@pharmacy/ui';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslations } from 'use-intl';
import { apiRequest } from '@/shared/api';
import { useBarcodeScanner } from '@/shared/lib/scanner';
import { useCameraAvailable } from '@/shared/lib/camera-scan';
import { CameraScanButton } from '@/shared/ui';

/** What a new product starts from: the scanned barcode, or the typed name (spec 2026-11-03-pos-store-ideas, D10). */
export type ProductSeed = { barcode: string } | { name: string };

/** 8–14 digits, as the catalog takes a barcode. */
const BARCODE = /^\d{8,14}$/;

/**
 * Adds a product to a document line: search by name, МНН or barcode, or a scan (the scanner works
 * without focusing the field). Results come from the stock of the store (`stock-products`). With
 * `create`, a search that found nothing offers to create the product (the documents that bring stock in).
 */
export function ProductSearch({
  storeId,
  supplierId,
  onPick,
  disabled = false,
  initialQuery = '',
  create,
  scanEnabled = true,
}: {
  storeId: string;
  /** Only the batches of this supplier (a supplier return). */
  supplierId?: string;
  onPick: (product: StockProductOption) => void;
  disabled?: boolean;
  /** The search to start with, e.g. a barcode scanned before the search was shown. */
  initialQuery?: string;
  /** «Завести товар»: `allowed` — the session may create products (`catalog:create`). */
  create?: { allowed: boolean; onCreate: (seed: ProductSeed) => void };
  /**
   * The scanner of the page goes to this search. False while a dialog over it takes the scan itself (the barcode field
   * of «Новый товар»): the scanner listens on the window and would add a line behind the dialog.
   */
  scanEnabled?: boolean;
}) {
  const t = useTranslations('stockDocs.search');
  const [query, setQuery] = useState(initialQuery);
  const trimmed = query.trim();
  const results = useQuery({
    queryKey: ['stock-products', storeId, trimmed, supplierId ?? ''],
    queryFn: ({ signal }) =>
      apiRequest('stock.products', {
        params: { storeId },
        query: { query: trimmed, limit: 8, supplierId },
        signal,
      }),
    enabled: trimmed.length >= 2 && !disabled,
  });

  // a code of the USB scanner or of the camera (ADR-0025): the product whose barcode it is, otherwise the search shows
  // the code — a QR text or a short Code 128 may match a name, which is never picked by itself (final review M5, M6)
  const handleScan = async (code: string) => {
    try {
      const found = await apiRequest('stock.products', {
        params: { storeId },
        query: { query: code, limit: 8, supplierId },
      });
      const product = found.find((option) => option.barcodes.includes(code));
      if (product) onPick(product);
      else setQuery(code);
    } catch {
      // the search of the field asks again and shows its own error
      setQuery(code);
    }
  };
  const camera = useCameraAvailable();
  useBarcodeScanner(handleScan, { enabled: !disabled && scanEnabled });

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
        endAdornment={
          camera ? (
            <CameraScanButton
              onScan={(code) => void handleScan(code)}
              disabled={disabled || !scanEnabled}
            />
          ) : undefined
        }
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
                      {product.retailPriceMinor === null
                        ? '—'
                        : formatMoney(product.retailPriceMinor)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : create && !results.isError ? (
            <div className="flex flex-col items-start gap-2 p-3 text-sm">
              <p className="text-fg-subtle">
                {BARCODE.test(trimmed)
                  ? t('notInCatalogBarcode', { code: trimmed })
                  : t('notInCatalogName', { name: trimmed })}
              </p>
              {create.allowed ? (
                <Button
                  variant="secondary"
                  iconStart="plus"
                  onClick={() =>
                    create.onCreate(
                      BARCODE.test(trimmed)
                        ? { barcode: trimmed }
                        : { name: trimmed },
                    )
                  }
                >
                  {t('createProduct')}
                </Button>
              ) : (
                <p className="text-fg-muted">{t('askToCreate')}</p>
              )}
            </div>
          ) : (
            <p className="p-3 text-sm text-fg-subtle">{t('nothing')}</p>
          )}
        </div>
      )}
    </div>
  );
}
