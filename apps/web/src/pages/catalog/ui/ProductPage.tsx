'use client';

import type { CatalogProductCard } from '@pharmacy/shared-dto';
import { formatDateOnly, formatMoney, toAppDate } from '@pharmacy/shared-util';
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
import { canWrite, useSession } from '@/entities/session';
import { apiRequest, useApiErrorMessage } from '@/shared/api';
import { routes } from '@/shared/config';
import { QueryState } from '@/shared/ui';
import { PageHeader } from '@/widgets/app-shell';
import { useCatalogReferences, useSupplierOptions } from './CatalogPage';
import {
  ProductForm,
  draftOf,
  draftProblems,
  inputOf,
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
  const tPricing = useTranslations('pricing');
  const tBatch = useTranslations('catalog.batchState');
  const today = toAppDate();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { data: session } = useSession();
  const canEdit = canWrite(session, 'catalog:update');
  const refs = useCatalogReferences();
  const suppliers = useSupplierOptions();
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
  const error = useApiErrorMessage(save.error);
  const problems = draftProblems(draft);
  const valid =
    !problems.nameRu && !problems.piecesPerPack && !problems.maxPrice;
  const warned = card.prices.some((p) => p.warnings.length > 0);

  return (
    <div className="grid grid-cols-(--ph-return-columns) items-start gap-4">
      <Card className="flex flex-col gap-4">
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
            suppliers={suppliers.data ?? []}
            touched={touched}
            disabled={!canEdit}
          />
        )}
        <div className="flex flex-wrap justify-end gap-2">
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
      <div className="flex flex-col gap-4">
        <Card padding="none">
          <CardHeader title={t('prices')} inset />
          <ul className="flex flex-col">
            {card.prices.map((price) => (
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
                  <b className="tabular-nums">
                    {formatMoney(price.priceMinor)}
                  </b>
                </span>
              </li>
            ))}
          </ul>
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
        <Card padding="none">
          <CardHeader title={t('batches')} inset />
          {card.batches.length === 0 ? (
            <p className="px-(--ph-card-padding) pb-4 text-sm text-fg-muted">
              {t('noBatches')}
            </p>
          ) : (
            <ul className="flex flex-col">
              {card.batches.map((batch) => (
                <li
                  key={`${batch.storeId}-${batch.batchNumber}`}
                  className="flex items-center justify-between gap-3 border-t border-border px-(--ph-card-padding) py-3 text-sm"
                >
                  <span className="flex flex-col">
                    <span className="font-medium">{batch.batchNumber}</span>
                    <span className="text-xs text-fg-subtle">
                      {batch.storeName} ·{' '}
                      {t('expires', { date: formatDateOnly(batch.expiresOn) })}
                    </span>
                  </span>
                  <span className="flex flex-col items-end gap-1">
                    <b className="whitespace-nowrap tabular-nums">
                      {t('quantity', {
                        packs: Math.trunc(
                          batch.quantityPieces / card.piecesPerPack,
                        ),
                        pieces: batch.quantityPieces % card.piecesPerPack,
                      })}
                    </b>
                    {batch.expiresOn < today && (
                      <StatusPill tone="danger">{tBatch('expired')}</StatusPill>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
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
