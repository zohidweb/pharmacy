'use client';

import type {
  DiscountRuleDefinition,
  DiscountRuleStatus,
  PriceConflict,
  PriceRow,
} from '@pharmacy/shared-dto';
import {
  formatDateOnly,
  formatDateTime,
  formatMoney,
} from '@pharmacy/shared-util';
import {
  Alert,
  Button,
  Card,
  CardHeader,
  DataTable,
  EmptyState,
  Icon,
  Pagination,
  Select,
  StatusPill,
  Tabs,
  TextField,
  type DataTableColumn,
  type StatusTone,
} from '@pharmacy/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslations } from 'use-intl';
import { can, canWrite, useSession } from '@/entities/session';
import { apiRequest, useApiErrorMessage } from '@/shared/api';
import { QueryState } from '@/shared/ui';
import { PageHeader } from '@/widgets/app-shell';
import { PriceDialog, RuleDialog } from './PricingDialogs';
import { WithMessages } from '@/shared/i18n';

const PAGE = 20;
type Tab = 'prices' | 'rules' | 'conflicts';

const ruleTone: Record<DiscountRuleStatus, StatusTone> = {
  active: 'success',
  scheduled: 'info',
  expired: 'neutral',
};

/** Prices and discounts (UI mockup «Цены и скидки»). */
function PricingPageView() {
  const t = useTranslations('pricing');
  const tDocs = useTranslations('stockDocs');
  const { data: session } = useSession();
  const [tab, setTab] = useState<Tab>('prices');
  const conflicts = useQuery({
    queryKey: ['prices', 'conflicts'],
    queryFn: ({ signal }) => apiRequest('priceConflicts.list', { signal }),
  });
  const canDiscounts = can(session, 'discounts:view');

  return (
    <>
      <PageHeader title={t('title')} />
      <div className="flex flex-col gap-4 px-6 pt-4">
        {session?.impersonation && (
          <Alert tone="info">{tDocs('notices.impersonation')}</Alert>
        )}
        <Tabs
          label={t('title')}
          value={tab}
          onValueChange={setTab}
          items={[
            { value: 'prices', label: t('tabs.prices'), panel: <PricesTab /> },
            ...(canDiscounts
              ? [
                  {
                    value: 'rules' as const,
                    label: t('tabs.rules'),
                    panel: <RulesTab />,
                  },
                ]
              : []),
            {
              value: 'conflicts',
              label: t('tabs.conflicts'),
              count: conflicts.data?.length,
              panel: <ConflictsTab rows={conflicts.data ?? []} />,
            },
          ]}
        />
      </div>
    </>
  );
}

function PricesTab() {
  const t = useTranslations('pricing');
  const tDocs = useTranslations('stockDocs');
  const { data: session } = useSession();
  const canEdit =
    canWrite(session, 'pricing:update-store') ||
    canWrite(session, 'pricing:update-network');
  const [q, setQ] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [offset, setOffset] = useState(0);
  const [editing, setEditing] = useState<PriceRow | null>(null);
  const categories = useQuery({
    queryKey: ['catalog', 'references'],
    queryFn: ({ signal }) => apiRequest('catalog.references', { signal }),
    staleTime: 5 * 60_000,
  });
  const list = useQuery({
    queryKey: ['prices', 'list', q, categoryId, offset],
    queryFn: ({ signal }) =>
      apiRequest('prices.list', {
        query: {
          q: q || undefined,
          categoryId: categoryId || undefined,
          limit: PAGE,
          offset,
        },
        signal,
      }),
    placeholderData: (previous) => previous,
  });

  return (
    <Card padding="none">
      <div className="grid grid-cols-(--ph-search-columns) gap-3 p-(--ph-card-padding)">
        <TextField
          label={t('search')}
          hideLabel
          type="search"
          placeholder={t('search')}
          value={q}
          onChange={(event) => {
            setQ(event.target.value);
            setOffset(0);
          }}
        />
        <Select
          label={t('category')}
          hideLabel
          value={categoryId}
          onChange={(event) => {
            setCategoryId(event.target.value);
            setOffset(0);
          }}
          options={[
            { value: '', label: t('allCategories') },
            ...(categories.data?.categories ?? []).map((c) => ({
              value: c.id,
              label: c.name,
            })),
          ]}
        />
      </div>
      <QueryState query={list}>
        {(data) => {
          const columns: DataTableColumn<PriceRow>[] = [
            {
              key: 'product',
              header: t('columns.product'),
              cell: (row) => (
                <div className="flex flex-col gap-1">
                  <b>{row.productName}</b>
                  {row.maxPriceMinor !== null && (
                    <span className="text-xs text-fg-subtle">
                      {t('regulatedMax', {
                        price: formatMoney(row.maxPriceMinor),
                      })}
                    </span>
                  )}
                </div>
              ),
            },
            ...(data.items[0]?.costMinor !== undefined
              ? [
                  {
                    key: 'cost',
                    header: t('columns.cost'),
                    numeric: true,
                    nowrap: true,
                    cell: (row: PriceRow) =>
                      row.costMinor
                        ? formatMoney(row.costMinor, { withSign: false })
                        : '—',
                  },
                ]
              : []),
            {
              key: 'markup',
              header: t('columns.markup'),
              numeric: true,
              cell: (row) =>
                row.markupPercent === null ? '—' : `${row.markupPercent} %`,
            },
            ...data.stores.map((store, index) => ({
              key: store.id,
              header: store.name,
              numeric: true,
              nowrap: true,
              cell: (row: PriceRow) => {
                const price = row.prices[index];
                if (!price) return '—';
                return (
                  <span className="inline-flex items-center gap-1">
                    {price.warnings.length > 0 && (
                      <span className="text-warning">
                        <Icon name="triangle-alert" size="sm" />
                      </span>
                    )}
                    {price.priceMinor === null
                      ? t('notSold')
                      : formatMoney(price.priceMinor, { withSign: false })}
                    {price.warnings.length > 0 && (
                      <span className="ph-visually-hidden">
                        {price.warnings
                          .map((w) => t(`warnings.${w}`))
                          .join(', ')}
                      </span>
                    )}
                  </span>
                );
              },
            })),
            {
              key: 'actions',
              header: (
                <span className="ph-visually-hidden">{tDocs('actions')}</span>
              ),
              cell: (row) =>
                canEdit ? (
                  <Button
                    variant="secondary"
                    iconStart="pencil"
                    onClick={() => setEditing(row)}
                  >
                    {t('editAction')}
                  </Button>
                ) : null,
            },
          ];
          return (
            <>
              <DataTable
                caption={t('tabs.prices')}
                rowKey={(row) => row.productId}
                rows={data.items}
                columns={columns}
                empty={<EmptyState icon="tag" title={t('empty')} />}
              />
              <p className="flex flex-wrap gap-4 px-(--ph-card-padding) py-3 text-xs text-fg-subtle">
                <span className="inline-flex items-center gap-1">
                  <Icon name="triangle-alert" size="sm" />
                  {t('legend')}
                </span>
                <span>{t('markupHint')}</span>
              </p>
              {data.total > PAGE && (
                <Pagination
                  className="px-4 py-3"
                  total={data.total}
                  limit={PAGE}
                  offset={offset}
                  onOffsetChange={setOffset}
                  labels={{
                    nav: t('pagination'),
                    previous: tDocs('previous'),
                    next: tDocs('next'),
                    range: (range) => tDocs('shown', range),
                  }}
                />
              )}
            </>
          );
        }}
      </QueryState>
      {editing && (
        <PriceDialog
          key={editing.productId}
          row={editing}
          onClose={() => setEditing(null)}
        />
      )}
    </Card>
  );
}

function RulesTab() {
  const t = useTranslations('pricing.rules');
  const tRule = useTranslations('pricing.rule');
  const { data: session } = useSession();
  const canNetwork = canWrite(session, 'discounts:manage-network');
  const canStore = canNetwork || canWrite(session, 'discounts:manage-store');
  const [editing, setEditing] = useState<DiscountRuleDefinition | 'new' | null>(
    null,
  );
  const list = useQuery({
    queryKey: ['discount-rules'],
    queryFn: ({ signal }) => apiRequest('discountRules.list', { signal }),
  });
  const canEditRule = (rule: DiscountRuleDefinition) =>
    rule.storeIds === null
      ? canNetwork
      : canNetwork ||
        (canStore &&
          rule.storeIds.every((id) =>
            session?.stores.some((s) => s.id === id),
          ));

  const columns: DataTableColumn<DiscountRuleDefinition>[] = [
    {
      key: 'name',
      header: t('name'),
      cell: (row) =>
        canEditRule(row) ? (
          <button
            type="button"
            onClick={() => setEditing(row)}
            className="min-h-touch text-start font-bold text-primary underline"
          >
            {row.name}
          </button>
        ) : (
          <b>{row.name}</b>
        ),
    },
    {
      key: 'condition',
      header: t('condition'),
      cell: (row) =>
        row.thresholds
          .map((th) =>
            t('threshold', {
              from: formatMoney(th.minSubtotalMinor),
              percent: th.percent,
            }),
          )
          .join(' · '),
    },
    {
      key: 'scope',
      header: t('scope'),
      cell: (row) =>
        row.storeIds === null ? t('network') : row.storeNames.join(', '),
    },
    {
      key: 'period',
      header: t('period'),
      nowrap: true,
      cell: (row) =>
        row.period
          ? `${formatDateOnly(row.period.from)} — ${
              row.period.to ? formatDateOnly(row.period.to) : t('noEnd')
            }`
          : tRule('indefinite'),
    },
    {
      key: 'author',
      header: t('author'),
      cell: (row) => `${row.author.name} (${row.author.role})`,
    },
    {
      key: 'status',
      header: t('status'),
      cell: (row) => (
        <StatusPill tone={ruleTone[row.status]}>
          {t(`statuses.${row.status}`)}
        </StatusPill>
      ),
    },
  ];

  return (
    <Card padding="none">
      <CardHeader
        title={t('title')}
        description={t('hint')}
        inset
        actions={
          <Button
            iconStart="plus"
            disabled={!canStore}
            onClick={() => setEditing('new')}
          >
            {tRule('newTitle')}
          </Button>
        }
      />
      <QueryState query={list}>
        {(rows) => (
          <DataTable
            caption={t('title')}
            rowKey={(row) => row.id}
            rows={rows}
            columns={columns}
            empty={<EmptyState icon="tag" title={t('empty')} />}
          />
        )}
      </QueryState>
      {editing && (
        <RuleDialog
          key={editing === 'new' ? 'new' : editing.id}
          rule={editing === 'new' ? null : editing}
          stores={(session?.stores ?? []).map((s) => ({
            id: s.id,
            name: s.name,
          }))}
          canNetwork={canNetwork}
          onClose={() => setEditing(null)}
        />
      )}
    </Card>
  );
}

/** Price conflicts of offline stores: the owner decides in the cloud (ADR-0014). */
function ConflictsTab({ rows }: { rows: PriceConflict[] }) {
  const t = useTranslations('pricing.conflicts');
  const { data: session } = useSession();
  const canResolve = canWrite(session, 'pricing:update-network');
  const queryClient = useQueryClient();
  const resolve = useMutation({
    mutationFn: (input: { id: string; keep: 'cloud' | 'local' }) =>
      apiRequest('priceConflicts.resolve', {
        params: { id: input.id },
        body: { keep: input.keep },
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['prices'] }),
  });
  const error = useApiErrorMessage(resolve.error);
  const columns: DataTableColumn<PriceConflict>[] = [
    {
      key: 'product',
      header: t('product'),
      cell: (row) => <b>{row.productName}</b>,
    },
    { key: 'store', header: t('store'), cell: (row) => row.storeName },
    {
      key: 'cloud',
      header: t('cloud'),
      numeric: true,
      cell: (row) => (
        <div className="flex flex-col">
          <span>{formatMoney(row.cloudPriceMinor)}</span>
          <span className="text-xs text-fg-subtle">
            {row.cloudChangedBy.name} ·{' '}
            {formatDateOnly(row.cloudChangedBy.at.slice(0, 10))}
          </span>
        </div>
      ),
    },
    {
      key: 'local',
      header: t('local'),
      numeric: true,
      cell: (row) => (
        <div className="flex flex-col">
          <span>{formatMoney(row.localPriceMinor)}</span>
          <span className="text-xs text-fg-subtle">
            {row.localChangedBy.name} ·{' '}
            {formatDateOnly(row.localChangedBy.at.slice(0, 10))}
          </span>
        </div>
      ),
    },
    {
      key: 'synced',
      header: t('synced'),
      nowrap: true,
      cell: (row) => formatDateTime(row.syncedAt),
    },
    {
      key: 'decision',
      header: t('decision'),
      cell: (row) =>
        canResolve ? (
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              loading={
                resolve.isPending &&
                resolve.variables?.id === row.id &&
                resolve.variables.keep === 'cloud'
              }
              aria-label={t('keepCloudOf', { product: row.productName })}
              onClick={() => resolve.mutate({ id: row.id, keep: 'cloud' })}
            >
              {t('keepCloud')}
            </Button>
            <Button
              variant="secondary"
              loading={
                resolve.isPending &&
                resolve.variables?.id === row.id &&
                resolve.variables.keep === 'local'
              }
              aria-label={t('keepLocalOf', { product: row.productName })}
              onClick={() => resolve.mutate({ id: row.id, keep: 'local' })}
            >
              {t('keepLocal')}
            </Button>
          </div>
        ) : (
          <span className="text-xs text-fg-subtle">{t('ownerDecides')}</span>
        ),
    },
  ];
  return (
    <Card padding="none">
      <CardHeader title={t('title')} description={t('hint')} inset />
      {error && (
        <div className="px-(--ph-card-padding) pb-3">
          <Alert tone="danger" live="assertive">
            {error}
          </Alert>
        </div>
      )}
      <DataTable
        caption={t('title')}
        rowKey={(row) => row.id}
        rows={rows}
        columns={columns}
        empty={<EmptyState icon="circle-check" title={t('empty')} />}
      />
    </Card>
  );
}

export function PricingPage() {
  return (
    <WithMessages groups={['stock', 'purchasing']}>
      <PricingPageView />
    </WithMessages>
  );
}
