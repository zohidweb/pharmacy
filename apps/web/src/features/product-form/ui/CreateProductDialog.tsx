'use client';

import type {
  CatalogProduct,
  CatalogReferences,
  StockProductOption,
} from '@pharmacy/shared-dto';
import { Alert, Button, Dialog } from '@pharmacy/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'use-intl';
import { apiFieldErrors, apiRequest, useApiErrorMessage } from '@/shared/api';
import { WithMessages } from '@/shared/i18n';
import { QueryState } from '@/shared/ui';
import { useCatalogReferences } from '../model/references';
import {
  ProductForm,
  draftProblems,
  emptyDraft,
  inputOf,
  shownAtFields,
  type ProductDraft,
} from './ProductForm';

/** What the new product starts from: a scanned barcode or a typed name (spec 2026-11-03-pos-store-ideas, D10). */
export type ProductSeed = { barcode: string } | { name: string };

export interface CreateProductDialogProps {
  seed: ProductSeed;
  /** The store of the document: the new product comes back as an option of its stock search. */
  storeId: string;
  onCreated: (product: StockProductOption) => void;
  onClose: () => void;
}

/**
 * «Новый товар» from a document line (spec 2026-11-03-pos-store-ideas, D11): the form of the catalog with the barcode
 * or the name of the search, then the new product goes straight into the document.
 */
export function CreateProductDialog(props: CreateProductDialogProps) {
  return (
    <WithMessages groups={['purchasing']}>
      <CreateProductView {...props} />
    </WithMessages>
  );
}

function CreateProductView({
  seed,
  storeId,
  onCreated,
  onClose,
}: CreateProductDialogProps) {
  const t = useTranslations('products');
  const refs = useCatalogReferences();

  return (
    <Dialog
      open
      onClose={onClose}
      title={t('new')}
      description={t('createFromSearch.hint')}
      closeLabel={t('createFromSearch.close')}
      size="lg"
    >
      <QueryState query={refs}>
        {(data) => (
          <CreateProductForm
            refs={data}
            seed={seed}
            storeId={storeId}
            onCreated={onCreated}
            onClose={onClose}
          />
        )}
      </QueryState>
    </Dialog>
  );
}

function CreateProductForm({
  refs,
  seed,
  storeId,
  onCreated,
  onClose,
}: CreateProductDialogProps & { refs: CatalogReferences }) {
  const t = useTranslations('products');
  const locale = useLocale();
  const queryClient = useQueryClient();
  // the name goes to the field of the interface language: the web does not know the default language of the network
  const [draft, setDraft] = useState<ProductDraft>(() => {
    const empty = emptyDraft(refs);
    if ('barcode' in seed)
      return { ...empty, barcodes: [{ code: seed.barcode }] };
    return locale === 'tg'
      ? { ...empty, nameTj: seed.name }
      : { ...empty, nameRu: seed.name };
  });
  const [touched, setTouched] = useState(false);
  const [lost, setLost] = useState(false);
  // the product once the catalog took it: a failed lookup after that is retried by «Сохранить» without a second product
  const [created, setCreated] = useState<CatalogProduct | null>(null);
  // the native dialog focuses its close button: the cashier types into the first empty field instead (D11). With the
  // references cached the form mounts with the dialog, and this effect runs before the dialog's showModal — so it waits.
  const formRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const fields = formRef.current?.querySelectorAll<HTMLInputElement>(
        'input:not([type=hidden]):not(:disabled)',
      );
      [...(fields ?? [])].find((field) => field.value === '')?.focus();
    });
    return () => window.clearTimeout(timer);
  }, []);
  const create = useMutation({
    mutationFn: async () => {
      let product = created;
      if (product === null) {
        product = await apiRequest('catalog.create', { body: inputOf(draft) });
        setCreated(product);
        // the catalog and the document searches: a search that found nothing before must find the new product now
        void queryClient.invalidateQueries({ queryKey: ['catalog'] });
        void queryClient.invalidateQueries({ queryKey: ['stock-products'] });
      }
      const options = await apiRequest('stock.products', {
        params: { storeId },
        query: {
          query:
            product.barcodes[0]?.code ?? (product.nameRu || product.nameTj),
          limit: 50,
        },
      });
      return options.find((option) => option.id === product.id) ?? null;
    },
    onSuccess: (option) => {
      if (option) onCreated(option);
      else setLost(true);
    },
  });
  const fieldErrors = apiFieldErrors(create.error);
  const error = useApiErrorMessage(
    shownAtFields(fieldErrors) ? null : create.error,
  );
  const problems = draftProblems(draft);
  const valid = !problems.name && !problems.piecesPerPack && !problems.maxPrice;
  // the search showed «нет в каталоге», yet the barcode is taken: the product holding it is archived (D11). Only while
  // the card holds just that code: a barcode added by hand or from the reference may belong to an active product.
  const barcodeArchived =
    'barcode' in seed &&
    draft.barcodes.every((barcode) => barcode.code === seed.barcode) &&
    fieldErrors.some((problem) => problem.code === 'barcode_taken');

  if (lost) {
    return (
      <div className="flex flex-col gap-4">
        <Alert tone="info">{t('createFromSearch.notFound')}</Alert>
        <div className="flex justify-end">
          <Button onClick={onClose}>{t('createFromSearch.close')}</Button>
        </div>
      </div>
    );
  }

  return (
    <div ref={formRef} className="flex flex-col gap-4">
      {error && (
        <Alert tone="danger" live="assertive">
          {error}
        </Alert>
      )}
      {barcodeArchived && (
        <Alert tone="info">{t('createFromSearch.barcodeArchived')}</Alert>
      )}
      <ProductForm
        draft={draft}
        onChange={setDraft}
        refs={refs}
        touched={touched}
        disabled={create.isPending || created !== null}
        fieldErrors={fieldErrors}
        lookup={{
          initialQuery: 'barcode' in seed ? seed.barcode : seed.name,
        }}
      />
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>
          {t('createFromSearch.cancel')}
        </Button>
        <Button
          loading={create.isPending}
          onClick={() => {
            setTouched(true);
            if (valid) create.mutate();
          }}
        >
          {t('save')}
        </Button>
      </div>
    </div>
  );
}
