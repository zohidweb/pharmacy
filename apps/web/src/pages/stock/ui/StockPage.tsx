'use client';

import type {
  StockRow,
  StockSortKey,
  StockStateFilter,
} from '@pharmacy/shared-dto';
import { formatDateOnly, formatMoney } from '@pharmacy/shared-util';
import {
  Button,
  buttonClassName,
  Card,
  Checkbox,
  Chip,
  ChipGroup,
  DataTable,
  EmptyState,
  Pagination,
  SegmentedControl,
  Select,
  StatusPill,
  TextField,
  type DataTableColumn,
  type SortState,
} from '@pharmacy/ui';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { useTranslations } from 'use-intl';
import { useSession } from '@/entities/session';
import { StockStatePill } from '@/entities/stock-document';
import { StockNotices, useStockAccess } from '@/features/stock-document';
import { apiRequest } from '@/shared/api';
import { routes } from '@/shared/config';
import { QueryState } from '@/shared/ui';
import { PageHeader } from '@/widgets/app-shell';

const PAGE = 20;
const STATES: StockStateFilter[] = [
  'all',
  'low',
  'expiring',
  'negative',
  'out',
];

function quantityText(
  row: StockRow,
  t: ReturnType<typeof useTranslations<'stock'>>,
) {
  const packs = Math.trunc(row.quantityPieces / row.piecesPerPack);
  const pieces = Math.abs(row.quantityPieces % row.piecesPerPack);
  return pieces > 0
    ? t('packsPieces', { packs, pieces })
    : t('packs', { packs });
}

/** Stock by batch (UI mockup «Остатки»): the whole network or one store of the scope. */
export function StockPage() {
  const t = useTranslations('stock');
  const tCommon = useTranslations('stockDocs');
  const { data: session } = useSession();
  const access = useStockAccess();
  const stores = session?.stores ?? [];
  // defaults follow the session until the employee chooses (the session may load after mount)
  const [viewChoice, setView] = useState<'network' | 'store' | null>(null);
  const [storeChoice, setStoreId] = useState<string | null>(null);
  const view = viewChoice ?? (stores.length > 1 ? 'network' : 'store');
  const storeId = storeChoice ?? session?.currentStoreId ?? stores[0]?.id ?? '';
  const [q, setQ] = useState('');
  const [state, setState] = useState<StockStateFilter>('all');
  const [sort, setSort] = useState<SortState<StockSortKey>>({
    key: 'product',
    direction: 'asc',
  });
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const list = useQuery({
    queryKey: ['stock', view, storeId, q.trim(), state, sort, offset],
    queryFn: ({ signal }) =>
      apiRequest('stock.list', {
        query: {
          storeId: view === 'store' ? storeId : undefined,
          q: q.trim() || undefined,
          state,
          sort: sort.key,
          direction: sort.direction,
          limit: PAGE,
          offset,
        },
        signal,
      }),
    placeholderData: (previous) => previous,
  });

  const reset = () => {
    setOffset(0);
    setSelected(new Set());
  };
  const rows = list.data?.items ?? [];
  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.id));

  const columns: DataTableColumn<StockRow, string>[] = [
    {
      key: 'select',
      header: (
        <Checkbox
          label={<span className="ph-visually-hidden">{t('selectAll')}</span>}
          checked={allSelected}
          onChange={(event) =>
            setSelected(
              event.target.checked ? new Set(rows.map((r) => r.id)) : new Set(),
            )
          }
        />
      ),
      cell: (row) => (
        <Checkbox
          label={
            <span className="ph-visually-hidden">
              {t('selectRow', { name: row.productName })}
            </span>
          }
          checked={selected.has(row.id)}
          onChange={(event) =>
            setSelected((current) => {
              const next = new Set(current);
              if (event.target.checked) next.add(row.id);
              else next.delete(row.id);
              return next;
            })
          }
        />
      ),
    },
    {
      key: 'product',
      header: t('product'),
      sortable: true,
      cell: (row) => (
        <span className="flex flex-col gap-0.5">
          <span className="font-medium">{row.productName}</span>
          <span className="flex flex-wrap items-center gap-2 text-xs text-fg-subtle">
            {view === 'network' ? row.storeName : row.barcode}
            {row.storeMode === 'offline' && (
              <StatusPill tone="neutral" icon="cloud-off">
                {t('offlineStore')}
              </StatusPill>
            )}
            {row.prescription === 'controlled' && (
              <StatusPill tone="danger" icon="lock">
                {t('controlled')}
              </StatusPill>
            )}
          </span>
        </span>
      ),
    },
    {
      key: 'batch',
      header: t('batch'),
      nowrap: true,
      cell: (row) => row.batchNumber ?? '—',
    },
    {
      key: 'expiresOn',
      header: t('expiresOn'),
      sortable: true,
      nowrap: true,
      cell: (row) => (row.expiresOn ? formatDateOnly(row.expiresOn) : '—'),
    },
    {
      key: 'quantity',
      header: t('quantity'),
      sortable: true,
      numeric: true,
      nowrap: true,
      cell: (row) => (
        <span
          className={
            row.quantityPieces < 0 ? 'font-bold text-danger' : undefined
          }
        >
          {quantityText(row, t)}
        </span>
      ),
    },
    {
      key: 'min',
      header: t('min'),
      numeric: true,
      cell: (row) => Math.round(row.minPieces / row.piecesPerPack),
    },
    ...(access.canSeeCost
      ? [
          {
            key: 'cost',
            header: t('cost'),
            numeric: true,
            nowrap: true,
            cell: (row: StockRow) =>
              row.costMinor !== undefined
                ? formatMoney(row.costMinor, { withSign: false })
                : '—',
          },
        ]
      : []),
    {
      key: 'price',
      header: t('price'),
      sortable: true,
      numeric: true,
      nowrap: true,
      cell: (row) => formatMoney(row.retailPriceMinor, { withSign: false }),
    },
    {
      key: 'state',
      header: t('stateHeader'),
      cell: (row) => <StockStatePill state={row.state} />,
    },
  ];

  const counts = list.data?.counts;
  return (
    <>
      <PageHeader
        title={t('title')}
        subtitle={t('subtitle')}
        actions={
          <>
            <Button
              variant="secondary"
              iconStart="download"
              disabled
              title={tCommon('soonHint')}
            >
              {t('excel')}
            </Button>
            <Link
              href={routes.stockCounts()}
              className={buttonClassName({ variant: 'secondary' })}
            >
              {t('toStockCount')}
            </Link>
          </>
        }
      />
      <div className="flex flex-col gap-4 px-6 pt-4">
        <StockNotices access={access} />
        <Card padding="none">
          <div className="flex flex-wrap items-end gap-3 border-b border-border p-4">
            {stores.length > 1 && (
              <SegmentedControl
                label={t('view')}
                value={view}
                onValueChange={(value) => {
                  setView(value);
                  reset();
                }}
                options={[
                  { value: 'network', label: t('network') },
                  { value: 'store', label: t('byStore') },
                ]}
              />
            )}
            {view === 'store' && stores.length > 1 && (
              <Select
                label={t('store')}
                hideLabel
                value={storeId}
                onChange={(event) => {
                  setStoreId(event.target.value);
                  reset();
                }}
                options={stores.map((s) => ({ value: s.id, label: s.name }))}
              />
            )}
            <div className="min-w-(--ph-size-dialog-sm) flex-1">
              <TextField
                label={t('search')}
                hideLabel
                type="search"
                placeholder={t('searchPlaceholder')}
                value={q}
                onChange={(event) => {
                  setQ(event.target.value);
                  reset();
                }}
              />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3 px-4 py-3">
            <ChipGroup label={t('stateFilter')}>
              {STATES.map((value) => (
                <Chip
                  key={value}
                  selected={state === value}
                  count={
                    value === 'low'
                      ? counts?.low
                      : value === 'expiring'
                        ? counts?.expiring
                        : value === 'negative'
                          ? counts?.negative
                          : undefined
                  }
                  onClick={() => {
                    setState(value);
                    reset();
                  }}
                >
                  {t(`filters.${value}`)}
                </Chip>
              ))}
            </ChipGroup>
          </div>
          {selected.size > 0 && (
            <div
              role="region"
              aria-label={t('bulk')}
              className="flex flex-wrap items-center gap-3 border-y border-border bg-surface-highlight px-4 py-2"
            >
              <b className="text-sm">
                {t('selected', { count: selected.size })}
              </b>
              <Button
                variant="secondary"
                iconStart="tag"
                disabled
                title={tCommon('soonHint')}
              >
                {t('printTags')}
              </Button>
              <Button
                variant="secondary"
                iconStart="download"
                disabled
                title={tCommon('soonHint')}
              >
                {t('exportSelected')}
              </Button>
              <Button variant="tertiary" onClick={() => setSelected(new Set())}>
                {t('clearSelection')}
              </Button>
              <span className="text-xs text-fg-subtle">
                {tCommon('soonHint')}
              </span>
            </div>
          )}
          <QueryState query={list}>
            {(data) => (
              <>
                <DataTable
                  caption={t('table')}
                  rowKey={(row) => row.id}
                  rows={data.items}
                  columns={columns}
                  sort={sort}
                  onSortChange={(next) => {
                    setSort(next as SortState<StockSortKey>);
                    reset();
                  }}
                  sortLabel={(direction) => tCommon(`sort.${direction}`)}
                  rowVariant={(row) =>
                    row.state === 'out' ? 'muted' : 'default'
                  }
                  empty={<EmptyState icon="package" title={t('empty')} />}
                />
                {data.total > PAGE && (
                  <Pagination
                    className="px-4 py-3"
                    total={data.total}
                    limit={PAGE}
                    offset={offset}
                    onOffsetChange={setOffset}
                    labels={{
                      nav: t('pagination'),
                      previous: tCommon('previous'),
                      next: tCommon('next'),
                      range: (range) => tCommon('shown', range),
                    }}
                  />
                )}
              </>
            )}
          </QueryState>
        </Card>
      </div>
    </>
  );
}
