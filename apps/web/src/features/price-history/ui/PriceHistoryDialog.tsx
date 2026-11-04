'use client';

import type { PriceHistoryEntry } from '@pharmacy/shared-dto';
import { formatDateTime, formatMoney } from '@pharmacy/shared-util';
import {
  Alert,
  Button,
  DataTable,
  Dialog,
  EmptyState,
  Select,
  Spinner,
  type DataTableColumn,
} from '@pharmacy/ui';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useLocale, useTranslations } from 'use-intl';
import { currentStoreOf, useSession } from '@/entities/session';
import { apiRequest, useApiErrorMessage } from '@/shared/api';

const PAGE = 50;
const ALL = '';

export interface PriceHistoryDialogProps {
  productId: string;
  productName: string;
  /** The stores of the filter: the stores of the screen that opened it. */
  stores: ReadonlyArray<{ id: string; name: string }>;
  onClose: () => void;
}

/**
 * The history of the prices of a product by store (spec 2026-11-03-pos-store-ideas, D14–D15): the newest change
 * first, by pages of 50; the retail and the wholesale prices in one list, told by the column «Вид».
 */
export function PriceHistoryDialog({
  productId,
  productName,
  stores,
  onClose,
}: PriceHistoryDialogProps) {
  const t = useTranslations('pricing.history');
  const locale = useLocale();
  const { data: session } = useSession();
  const current = currentStoreOf(session)?.id;
  const [storeId, setStoreId] = useState(() =>
    current && stores.some((s) => s.id === current) ? current : ALL,
  );
  const history = useInfiniteQuery({
    queryKey: ['prices', 'history', productId, storeId],
    queryFn: ({ pageParam, signal }) =>
      apiRequest('prices.history', {
        params: { productId },
        query: {
          storeId: storeId === ALL ? undefined : storeId,
          limit: PAGE,
          offset: pageParam,
        },
        signal,
      }),
    initialPageParam: 0,
    getNextPageParam: (last) =>
      last.offset + last.items.length < last.total
        ? last.offset + last.items.length
        : undefined,
  });
  const error = useApiErrorMessage(history.error);
  const rows = history.data?.pages.flatMap((page) => page.items) ?? [];
  const percent = new Intl.NumberFormat(locale === 'tg' ? 'tg' : 'ru', {
    signDisplay: 'exceptZero',
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });

  const sourceOf = (entry: PriceHistoryEntry) => {
    const number = entry.document?.number ?? '';
    switch (entry.source) {
      case 'offline_store':
        return t('sources.offlineStore');
      case 'transfer':
        return t('sources.transfer', { number });
      case 'document':
        return entry.document?.type === 'goods_receipt'
          ? t('sources.goodsReceipt', { number })
          : entry.document?.type === 'opening_balance'
            ? t('sources.openingBalance', { number })
            : t('sources.document', { number });
      default:
        return t('sources.manual');
    }
  };

  const columns: DataTableColumn<PriceHistoryEntry>[] = [
    {
      key: 'at',
      header: t('at'),
      nowrap: true,
      cell: (row) => formatDateTime(row.at),
    },
    ...(storeId === ALL
      ? [
          {
            key: 'store',
            header: t('store'),
            cell: (row: PriceHistoryEntry) => row.storeName,
          },
        ]
      : []),
    {
      key: 'kind',
      header: t('kind'),
      cell: (row) => t(`kinds.${row.kind}`),
    },
    {
      key: 'old',
      header: t('old'),
      numeric: true,
      cell: (row) =>
        row.oldPriceMinor === null ? '—' : formatMoney(row.oldPriceMinor),
    },
    {
      key: 'new',
      header: t('new'),
      numeric: true,
      // null — the wholesale of the product at the store was closed
      cell: (row) =>
        row.newPriceMinor === null
          ? t('closed')
          : formatMoney(row.newPriceMinor),
    },
    {
      key: 'change',
      header: t('change'),
      numeric: true,
      // a percent for the eye only: money stays integer dirams
      cell: (row) =>
        row.oldPriceMinor === null ||
        row.oldPriceMinor === 0 ||
        row.newPriceMinor === null
          ? '—'
          : `${percent.format(((row.newPriceMinor - row.oldPriceMinor) / row.oldPriceMinor) * 100)} %`,
    },
    {
      key: 'author',
      header: t('author'),
      cell: (row) => row.author?.name ?? '—',
    },
    { key: 'source', header: t('source'), cell: sourceOf },
  ];

  return (
    <Dialog
      open
      onClose={onClose}
      title={t('title', { name: productName })}
      closeLabel={t('close')}
      size="xl"
      footer={
        <Button variant="secondary" onClick={onClose}>
          {t('close')}
        </Button>
      }
    >
      <div className="flex flex-col gap-4">
        <Select
          label={t('storeFilter')}
          value={storeId}
          options={[
            { value: ALL, label: t('allStores') },
            ...stores.map((s) => ({ value: s.id, label: s.name })),
          ]}
          onChange={(event) => setStoreId(event.target.value)}
        />
        {error && (
          <Alert tone="danger" live="assertive">
            {error}
          </Alert>
        )}
        {history.isPending ? (
          <div className="grid place-items-center py-8 text-primary">
            <Spinner size="lg" label={t('loading')} />
          </div>
        ) : (
          !history.isError && (
            <DataTable
              caption={t('caption')}
              rowKey={(row) => row.id}
              rows={rows}
              columns={columns}
              empty={<EmptyState icon="clock" title={t('empty')} />}
            />
          )
        )}
        {history.hasNextPage && (
          <Button
            variant="secondary"
            loading={history.isFetchingNextPage}
            onClick={() => void history.fetchNextPage()}
          >
            {t('more')}
          </Button>
        )}
      </div>
    </Dialog>
  );
}
