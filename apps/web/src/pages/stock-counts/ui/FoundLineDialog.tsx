'use client';

import type { FoundLineInput, StockCountLine } from '@pharmacy/shared-dto';
import { Alert, Button, Dialog, TextField } from '@pharmacy/ui';
import { useState } from 'react';
import { useTranslations } from 'use-intl';
import { MoneyInput, ProductSearch } from '@/features/stock-document';
import { useApiErrorMessage } from '@/shared/api';

/**
 * A product found on the shelf without a book batch (spec 2026-10-12, S1): the product, the batch
 * number, the expiry and the purchase price of a pack; the price — only with the cost right, a
 * manager may add it before posting.
 */
export function FoundLineDialog({
  storeId,
  line,
  canSeeCost,
  busy,
  error,
  onSave,
  onClose,
}: {
  storeId: string;
  /** null — a new found product. */
  line: StockCountLine | null;
  canSeeCost: boolean;
  busy: boolean;
  error: unknown;
  onSave: (input: FoundLineInput) => void;
  onClose: () => void;
}) {
  const t = useTranslations('stockCounts.found');
  const tDocs = useTranslations('stockDocs');
  const [product, setProduct] = useState(
    line ? { id: line.productId, name: line.productName } : null,
  );
  const [batchNumber, setBatchNumber] = useState(line?.batchNumber ?? '');
  const [expiresOn, setExpiresOn] = useState(line?.expiresOn ?? '');
  const [costMinor, setCostMinor] = useState(line?.costMinor ?? 0);
  const message = useApiErrorMessage(error);

  return (
    <Dialog
      open
      onClose={onClose}
      title={line ? t('editTitle') : t('title')}
      closeLabel={tDocs('close')}
      size="md"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {tDocs('cancel')}
          </Button>
          <Button
            loading={busy}
            disabled={product === null}
            onClick={() =>
              product &&
              onSave({
                productId: product.id,
                batchNumber: batchNumber.trim(),
                expiresOn: expiresOn || null,
                costMinor: canSeeCost && costMinor > 0 ? costMinor : null,
              })
            }
          >
            {t('save')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {message && (
          <Alert tone="danger" live="assertive">
            {message}
          </Alert>
        )}
        <p className="text-sm text-fg-muted">{t('hint')}</p>
        {product ? (
          <p className="flex items-center justify-between gap-2 text-sm">
            <b>{product.name}</b>
            {!line && (
              <Button variant="tertiary" onClick={() => setProduct(null)}>
                {t('change')}
              </Button>
            )}
          </p>
        ) : (
          <ProductSearch
            storeId={storeId}
            onPick={(picked) =>
              setProduct({ id: picked.id, name: picked.name })
            }
          />
        )}
        <div className="grid grid-cols-2 gap-4">
          <TextField
            label={t('batchNumber')}
            value={batchNumber}
            onChange={(event) => setBatchNumber(event.target.value)}
          />
          <TextField
            label={t('expiresOn')}
            type="date"
            value={expiresOn}
            onChange={(event) => setExpiresOn(event.target.value)}
          />
        </div>
        {canSeeCost ? (
          <MoneyInput
            label={t('cost')}
            hideLabel={false}
            valueMinor={costMinor}
            allowEmpty
            invalidText={tDocs('checkValue')}
            onChange={setCostMinor}
          />
        ) : (
          <p className="text-xs text-fg-subtle">{t('costByManager')}</p>
        )}
      </div>
    </Dialog>
  );
}
