'use client';

import type { CatalogProductCard } from '@pharmacy/shared-dto';
import { formatMoney } from '@pharmacy/shared-util';
import {
  Alert,
  Button,
  Card,
  CardHeader,
  Icon,
  StatusPill,
  useToast,
} from '@pharmacy/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { useTranslations } from 'use-intl';
import { can, canWrite, useSession } from '@/entities/session';
import {
  apiFieldErrors,
  apiRequest,
  useApiErrorMessage,
} from '@/shared/api';
import { routes } from '@/shared/config';
import { QueryState } from '@/shared/ui';
import { PageHeader } from '@/widgets/app-shell';
import { useCatalogReferences } from './CatalogPage';
import {
  ProductForm,
  draftOf,
  draftProblems,
  inputOf,
  shownAtFields,
  type ProductDraft,
} from './ProductForm';
import { WithMessages } from '@/shared/i18n';

function ProductView() {
  const t = useTranslations('products.card');
  const id = useSearchParams()?.get('id') ?? '';
  const card = useQuery({
    queryKey: ['catalog', 'card', id],
    queryFn: ({ signal }) =>
      apiRequest('catalog.get', { params: { id }, signal }),
    enabled: Boolean(id),
  });

  return (
    <>
      <PageHeader
        title={card.data?.nameRu ?? t('title')}
        subtitle={card.data?.categoryName}
      />
      <div className="flex flex-col gap-4 px-6 pt-4">
        <Link
          href={routes.catalog()}
          className="inline-flex min-h-touch items-center gap-1 self-start text-sm text-primary hover:text-primary-hover"
        >
          <Icon name="arrow-left" size="sm" />
          {t('back')}
        </Link>
        <QueryState query={card}>
          {(data) => <ProductCardBody key={data.id} card={data} />}
        </QueryState>
      </div>
    </>
  );
}

function ProductCardBody({ card }: { card: CatalogProductCard }) {
  const t = useTranslations('products.card');
  const toast = useToast();
  const queryClient = useQueryClient();
  const { data: session } = useSession();
  const archived = card.status === 'archived';
  const canEdit = canWrite(session, 'catalog:update') && !archived;
  const canArchive = canWrite(session, 'catalog:delete');
  const refs = useCatalogReferences();
  const [draft, setDraft] = useState<ProductDraft>(() => draftOf(card));
  const [touched, setTouched] = useState(false);
  const save = useMutation({
    mutationFn: () =>
      apiRequest('catalog.update', {
        params: { id: card.id },
        body: inputOf(draft),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['catalog'] });
      toast.show(t('saved'));
    },
  });
  const setStatus = useMutation({
    mutationFn: () =>
      apiRequest('catalog.status', {
        params: { id: card.id },
        body: { status: archived ? 'active' : 'archived' },
      }),
    onSuccess: (product) => {
      void queryClient.invalidateQueries({ queryKey: ['catalog'] });
      void queryClient.invalidateQueries({ queryKey: ['prices'] });
      toast.show(
        t(product.status === 'archived' ? 'archivedToast' : 'restoredToast'),
      );
    },
  });
  const fieldErrors = apiFieldErrors(save.error);
  // a rejected field is shown at the field itself
  const error = useApiErrorMessage(
    shownAtFields(fieldErrors)
      ? setStatus.error
      : (save.error ?? setStatus.error),
  );
  const problems = draftProblems(draft);
  const valid =
    !problems.nameRu && !problems.piecesPerPack && !problems.maxPrice;

  return (
    <div className="grid grid-cols-(--ph-return-columns) items-start gap-4">
      <Card className="flex flex-col gap-4">
        {archived && <Alert tone="info">{t('archivedNotice')}</Alert>}
        {error && (
          <Alert tone="danger" live="assertive">
            {error}
          </Alert>
        )}
        {refs.data && (
          <ProductForm
            draft={draft}
            onChange={setDraft}
            refs={refs.data}
            touched={touched}
            disabled={!canEdit}
            fieldErrors={fieldErrors}
          />
        )}
        <div className="flex flex-wrap justify-end gap-2">
          {canArchive && (
            <Button
              variant="secondary"
              iconStart={archived ? 'undo-2' : 'inbox'}
              loading={setStatus.isPending}
              onClick={() => setStatus.mutate()}
            >
              {t(archived ? 'restore' : 'archive')}
            </Button>
          )}
          <Button
            variant="secondary"
            iconStart="printer"
            disabled
            aria-describedby="tag-pending"
          >
            {t('printTag')}
          </Button>
          {canEdit && (
            <Button
              loading={save.isPending}
              onClick={() => {
                setTouched(true);
                if (valid) save.mutate();
              }}
            >
              {t('save')}
            </Button>
          )}
        </div>
        <p id="tag-pending" className="text-xs text-fg-subtle">
          {t('tagPending')}
        </p>
      </Card>
      {can(session, 'pricing:view') && <ProductPrices card={card} />}
    </div>
  );
}

/** Prices of the product at the stores of the scope (GET /prices/{id}); batches come with stock. */
function ProductPrices({ card }: { card: CatalogProductCard }) {
  const t = useTranslations('products.card');
  const tPricing = useTranslations('pricing');
  const prices = useQuery({
    queryKey: ['prices', 'product', card.id],
    queryFn: ({ signal }) =>
      apiRequest('prices.get', { params: { productId: card.id }, signal }),
  });
  const warned = prices.data?.some((p) => p.warnings.length > 0) ?? false;

  return (
    <Card padding="none">
      <CardHeader title={t('prices')} inset />
      <QueryState query={prices}>
        {(rows) => (
          <ul className="flex flex-col">
            {rows.map((price) => (
              <li
                key={price.storeId}
                className="flex items-center justify-between gap-3 border-t border-border px-(--ph-card-padding) py-3 text-sm"
              >
                <span>{price.storeName}</span>
                <span className="flex items-center gap-2">
                  {price.warnings.map((w) => (
                    <StatusPill key={w} tone="warning">
                      {tPricing(`warnings.${w}`)}
                    </StatusPill>
                  ))}
                  {price.priceMinor === null ? (
                    <span className="text-fg-muted">{t('notSold')}</span>
                  ) : (
                    <b className="tabular-nums">
                      {formatMoney(price.priceMinor)}
                    </b>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </QueryState>
      {card.maxPriceMinor !== null && (
        <p className="border-t border-border px-(--ph-card-padding) py-3 text-xs text-fg-subtle">
          {t('maxPrice', { price: formatMoney(card.maxPriceMinor) })}
        </p>
      )}
      {warned && (
        <p className="px-(--ph-card-padding) pb-3 text-xs text-fg-subtle">
          <Link href={routes.pricing()} className="text-primary underline">
            {t('toPricing')}
          </Link>
        </p>
      )}
    </Card>
  );
}

/** Product card (UI mockup «Карточка товара»): `/catalog/view?id=` — static export, no dynamic route. */
function ProductPageView() {
  return (
    <Suspense>
      <ProductView />
    </Suspense>
  );
}

export function ProductPage() {
  return (
    <WithMessages groups={['stock', 'purchasing']}>
      <ProductPageView />
    </WithMessages>
  );
}
