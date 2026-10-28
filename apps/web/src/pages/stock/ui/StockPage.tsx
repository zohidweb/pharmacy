'use client';

import type {
  ReorderLine,
  StockRow,
  StockSortKey,
  StockStateFilter,
} from '@pharmacy/shared-dto';
import {
  EXPORT_ROW_LIMIT,
  formatDateOnly,
  formatDateTime,
  formatMoney,
  xlsxFileName,
} from '@pharmacy/shared-util';
import {
  Alert,
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
import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { useFormatter, useTranslations } from 'use-intl';
import { can, useSession } from '@/entities/session';
import { StockStatePill } from '@/entities/stock-document';
import { PrintTagsDialog, stockTags } from '@/features/print-price-tags';
import { StockNotices, useStockAccess } from '@/features/stock-document';
import { apiRequest } from '@/shared/api';
import { routes } from '@/shared/config';
import { QueryState } from '@/shared/ui';
import { PageHeader } from '@/widgets/app-shell';
import { WithMessages } from '@/shared/i18n';
import { useXlsxExport } from '@/shared/lib/xlsx-export';
import { reorderSheet, stockSheet } from '../lib/stock-sheet';

const PAGE = 20;
const STATES: StockStateFilter[] = [
  'all',
  'low',
  'expiring',
  'negative',
  'out',
];

function piecesText(
  quantityPieces: number,
  piecesPerPack: number,
  t: ReturnType<typeof useTranslations<'stock'>>,
) {
  const packs = Math.trunc(quantityPieces / piecesPerPack);
  const pieces = Math.abs(quantityPieces % piecesPerPack);
  return pieces > 0
    ? t('packsPieces', { packs, pieces })
    : t('packs', { packs });
}

const quantityText = (
  row: StockRow,
  t: ReturnType<typeof useTranslations<'stock'>>,
) => piecesText(row.quantityPieces, row.piecesPerPack, t);

const matches = (name: string, q: string) =>
  name
    .normalize('NFC')
    .toLowerCase()
    .includes(q.normalize('NFC').toLowerCase());

/**
 * Stock by batch (UI mockup «Остатки»): the whole network or one store of the scope. The menu counter
 * opens it with `?view=reorder&storeId=` — the list «Надо заказать» of that store.
 */
function StockPageView({
  initialReorder,
  initialStoreId,
}: {
  initialReorder: boolean;
  initialStoreId: string | null;
}) {
  const t = useTranslations('stock');
  const tCommon = useTranslations('stockDocs');
  const tExport = useTranslations('export');
  const tTags = useTranslations('priceTags');
  const [tagsOpen, setTagsOpen] = useState(false);
  const format = useFormatter();
  const xlsx = useXlsxExport();
  const { data: session } = useSession();
  const access = useStockAccess();
  const stores = session?.stores ?? [];
  // defaults follow the session until the employee chooses (the session may load after mount)
  const [viewChoice, setView] = useState<'network' | 'store' | null>(
    initialStoreId ? 'store' : null,
  );
  const [storeChoice, setStoreId] = useState<string | null>(initialStoreId);
  const [reorder, setReorder] = useState(initialReorder);
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
    enabled: !reorder,
  });
  // «Надо заказать» (spec 2026-10-15-nav-counters, N4): one row per product, the whole list at once
  const reorderList = useQuery({
    queryKey: ['stock', 'reorder', view, storeId],
    queryFn: ({ signal }) =>
      apiRequest('stock.reorder', {
        query: view === 'store' ? { storeId } : {},
        signal,
      }),
    enabled: reorder,
    // opened from the menu counter: the list must match its number, not a cache up to 30 s old
    refetchOnMount: 'always',
  });

  const reset = () => {
    setOffset(0);
    setSelected(new Set());
  };
  const rows = list.data?.items ?? [];
  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.id));

  // the Excel export (plan 2026-10-27-excel-export, X7, X9, X10)
  const canExport = can(session, 'inventory:export');
  const storeName = stores.find((s) => s.id === storeId)?.name ?? null;
  const place =
    view === 'network'
      ? t('network')
      : tExport('store', { name: storeName ?? '—' });
  const fileName = (title: string) =>
    xlsxFileName(title, view === 'network' ? t('network') : storeName);
  const madeAt = () =>
    tExport('madeAt', { at: formatDateTime(new Date().toISOString()) });
  const stockTexts = (heading: string[]) => ({
    name: t('title'),
    heading,
    columns: {
      product: t('product'),
      barcode: tExport('barcode'),
      store: t('store'),
      controlled: t('controlled'),
      batch: t('batch'),
      expiresOn: t('expiresOn'),
      quantity: tExport('pieces', { header: t('quantity') }),
      perPack: tExport('perPack'),
      min: tExport('pieces', { header: t('reorder.min') }),
      cost: t('cost'),
      price: t('price'),
      state: t('stateHeader'),
    },
    controlled: tExport('controlled'),
    state: (value: StockRow['state']) => t(`state.${value}`),
  });
  const exportStock = () =>
    xlsx.run(async () => {
      if (reorder) {
        return {
          sheet: reorderSheet(reorderList.data ?? [], {
            name: t('reorder.table'),
            heading: [t('reorder.table'), place, madeAt()],
            columns: {
              product: t('product'),
              store: t('store'),
              stock: tExport('pieces', { header: t('reorder.stock') }),
              min: tExport('pieces', { header: t('reorder.min') }),
              shortage: tExport('pieces', { header: t('reorder.shortage') }),
              perPack: tExport('perPack'),
            },
          }),
          fileName: fileName(t('reorder.table')),
        };
      }
      // the whole list of the filters in one request
      const data = await apiRequest('stock.list', {
        query: {
          storeId: view === 'store' ? storeId : undefined,
          q: q.trim() || undefined,
          state,
          sort: sort.key,
          direction: sort.direction,
          limit: EXPORT_ROW_LIMIT,
          offset: 0,
        },
        timeoutMs: 60_000,
      });
      if (data.total > EXPORT_ROW_LIMIT) {
        return {
          refused: tExport('tooManyStock', {
            limit: format.number(EXPORT_ROW_LIMIT),
          }),
        };
      }
      const filters = [
        place,
        state !== 'all' && tExport('state', { name: t(`filters.${state}`) }),
        q.trim() && tExport('search', { q: q.trim() }),
      ].filter((part): part is string => !!part);
      return {
        sheet: stockSheet(
          data.items,
          stockTexts([t('title'), filters.join(' · '), madeAt()]),
          { canSeeCost: access.canSeeCost },
        ),
        fileName: fileName(t('title')),
      };
    });
  // the selected rows of the page
  // price tags of the selected rows: one per store × product with a price (plan 2026-10-28-price-tags-qr, T7)
  const selectedTags = stockTags(
    rows.filter((r) => selected.has(r.id)),
    (pieces) => tTags('pack', { count: pieces }),
  );
  const exportSelected = () =>
    xlsx.run(() => {
      const picked = rows.filter((r) => selected.has(r.id));
      return {
        sheet: stockSheet(
          picked,
          stockTexts([
            t('title'),
            `${place} · ${tExport('selected', { count: picked.length })}`,
            madeAt(),
          ]),
          { canSeeCost: access.canSeeCost },
        ),
        fileName: fileName(t('title')),
      };
    });

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
      cell: (row) =>
        row.retailPriceMinor === null
          ? '—'
          : formatMoney(row.retailPriceMinor, { withSign: false }),
    },
    {
      key: 'state',
      header: t('stateHeader'),
      cell: (row) => <StockStatePill state={row.state} />,
    },
  ];
  const reorderColumns: DataTableColumn<ReorderLine>[] = [
    {
      key: 'product',
      header: t('product'),
      cell: (line) => (
        <span className="flex flex-col gap-0.5">
          <span className="font-medium">{line.productName}</span>
          {view === 'network' && (
            <span className="text-xs text-fg-subtle">{line.storeName}</span>
          )}
        </span>
      ),
    },
    {
      key: 'stock',
      header: t('reorder.stock'),
      numeric: true,
      nowrap: true,
      cell: (line) => piecesText(line.stockPieces, line.piecesPerPack, t),
    },
    {
      key: 'min',
      header: t('reorder.min'),
      numeric: true,
      nowrap: true,
      cell: (line) => piecesText(line.minPieces, line.piecesPerPack, t),
    },
    {
      key: 'shortage',
      header: t('reorder.shortage'),
      numeric: true,
      nowrap: true,
      cell: (line) => (
        <b>{piecesText(line.shortagePieces, line.piecesPerPack, t)}</b>
      ),
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
            {canExport && (
              <Button
                variant="secondary"
                iconStart="download"
                loading={xlsx.busy}
                disabled={reorder ? !reorderList.data : !list.data}
                onClick={() => void exportStock()}
              >
                {t('excel')}
              </Button>
            )}
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
        {xlsx.message && <Alert tone="warning">{xlsx.message}</Alert>}
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
                  selected={!reorder && state === value}
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
                    setReorder(false);
                    reset();
                  }}
                >
                  {t(`filters.${value}`)}
                </Chip>
              ))}
              <Chip
                selected={reorder}
                count={reorderList.data?.length}
                onClick={() => {
                  setReorder(true);
                  reset();
                }}
              >
                {t('filters.reorder')}
              </Chip>
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
                onClick={() => setTagsOpen(true)}
              >
                {t('printTags')}
              </Button>
              {canExport && (
                <Button
                  variant="secondary"
                  iconStart="download"
                  loading={xlsx.busy}
                  onClick={() => void exportSelected()}
                >
                  {t('exportSelected')}
                </Button>
              )}
              <Button variant="tertiary" onClick={() => setSelected(new Set())}>
                {t('clearSelection')}
              </Button>
            </div>
          )}
          <PrintTagsDialog
            open={tagsOpen}
            title={tTags('printMany')}
            tags={selectedTags.tags}
            skipped={selectedTags.skipped}
            onClose={() => setTagsOpen(false)}
          />
          {reorder ? (
            <QueryState query={reorderList}>
              {(lines) => (
                <>
                  <DataTable
                    caption={t('reorder.table')}
                    rowKey={(line) => `${line.storeId}/${line.productId}`}
                    rows={
                      q.trim()
                        ? lines.filter((line) =>
                            matches(line.productName, q.trim()),
                          )
                        : lines
                    }
                    columns={reorderColumns}
                    rowVariant={(line) =>
                      line.stockPieces === 0 ? 'muted' : 'default'
                    }
                    empty={
                      <EmptyState icon="package" title={t('reorder.empty')} />
                    }
                  />
                  <p className="px-4 py-3 text-xs text-fg-subtle">
                    {t('reorder.hint')}
                  </p>
                </>
              )}
            </QueryState>
          ) : (
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
          )}
        </Card>
      </div>
    </>
  );
}

/** The filter comes from the address; a new address (a click on the menu counter) starts afresh. */
function StockPageRoute() {
  const params = useSearchParams();
  return (
    <StockPageView
      key={params?.toString() ?? ''}
      initialReorder={params?.get('view') === 'reorder'}
      initialStoreId={params?.get('storeId') || null}
    />
  );
}

export function StockPage() {
  return (
    <WithMessages groups={['stock']}>
      <Suspense>
        <StockPageRoute />
      </Suspense>
    </WithMessages>
  );
}
