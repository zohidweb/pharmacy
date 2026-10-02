'use client';

import type {
  StockCount,
  StockCountListItem,
  StockCountScope,
} from '@pharmacy/shared-dto';
import { formatDateTime, formatMoney } from '@pharmacy/shared-util';
import {
  Alert,
  Button,
  Card,
  DataTable,
  Dialog,
  EmptyState,
  RadioCardGroup,
  Select,
  type DataTableColumn,
} from '@pharmacy/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslations } from 'use-intl';
import { useCatalog } from '@/entities/catalog';
import { useSession } from '@/entities/session';
import { DocumentStatusPill } from '@/entities/stock-document';
import { useTerminalRuntime } from '@/entities/terminal';
import { StockNotices, useStockAccess } from '@/features/stock-document';
import { apiRequest, useApiErrorMessage } from '@/shared/api';
import { QueryState } from '@/shared/ui';
import { PageHeader } from '@/widgets/app-shell';
import { StockCountEditor } from './StockCountEditor';
import { WithMessages } from '@/shared/i18n';

/** Stock counts (UI mockup «Инвентаризация»). */
function StockCountsPageView() {
  const t = useTranslations('stockCounts');
  const tDocs = useTranslations('stockDocs');
  const queryClient = useQueryClient();
  const { data: session } = useSession();
  const access = useStockAccess();
  const categories =
    useCatalog(useTerminalRuntime(), session?.currentStoreId ?? null).data
      ?.snapshot.categories ?? [];
  const [editing, setEditing] = useState<StockCount | null>(null);
  const [starting, setStarting] = useState(false);
  const [storeId, setStoreId] = useState(access.writableStores[0]?.id ?? '');
  const [scope, setScope] = useState<StockCountScope>('all');
  const [categoryId, setCategoryId] = useState('');

  const list = useQuery({
    queryKey: ['stock-counts'],
    queryFn: ({ signal }) =>
      apiRequest('stockCounts.list', { query: { limit: 50 }, signal }),
  });
  const open = useMutation({
    mutationFn: (id: string) =>
      apiRequest('stockCounts.get', { params: { id } }),
    onSuccess: setEditing,
  });
  const start = useMutation({
    mutationFn: () =>
      apiRequest('stockCounts.start', {
        body: {
          storeId,
          scope,
          categoryId: scope === 'category' ? categoryId || null : null,
          productIds: [],
        },
      }),
    onSuccess: (doc) => {
      setStarting(false);
      setEditing(doc);
      void queryClient.invalidateQueries({ queryKey: ['stock-counts'] });
    },
  });
  const error = useApiErrorMessage(open.error ?? start.error);

  const columns: DataTableColumn<StockCountListItem>[] = [
    {
      key: 'number',
      header: '№',
      cell: (row) => (
        <button
          type="button"
          onClick={() => open.mutate(row.id)}
          className="min-h-touch font-bold text-primary underline"
        >
          {row.number}
        </button>
      ),
    },
    {
      key: 'started',
      header: t('started'),
      nowrap: true,
      cell: (row) => formatDateTime(row.startedAt),
    },
    { key: 'store', header: tDocs('store'), cell: (row) => row.storeName },
    {
      key: 'scope',
      header: t('scope'),
      cell: (row) =>
        `${t(`scopes.${row.scope}`)}${row.categoryName ? ` · ${row.categoryName}` : ''}`,
    },
    {
      key: 'positions',
      header: tDocs('positions'),
      numeric: true,
      cell: (row) => row.positions,
    },
    {
      key: 'diff',
      header: t('diff'),
      cell: (row) =>
        t('diffCounts', {
          surplus: row.surplusLines,
          shortage: row.shortageLines,
        }),
    },
    ...(access.canSeeCost
      ? [
          {
            key: 'sum',
            header: t('diffSum'),
            numeric: true,
            nowrap: true,
            cell: (row: StockCountListItem) =>
              row.diffMinor !== undefined
                ? formatMoney(row.diffMinor, { withSign: false })
                : '—',
          },
        ]
      : []),
    {
      key: 'status',
      header: tDocs('statusHeader'),
      cell: (row) => <DocumentStatusPill status={row.status} />,
    },
  ];

  return (
    <>
      <PageHeader
        title={t('title')}
        actions={
          <Button
            iconStart="plus"
            disabled={!access.canCreate}
            onClick={() => setStarting(true)}
          >
            {t('start')}
          </Button>
        }
      />
      <div className="flex flex-col gap-4 px-6 pt-4">
        <StockNotices access={access} />
        {error && (
          <Alert tone="danger" live="assertive">
            {error}
          </Alert>
        )}
        <Card padding="none">
          <QueryState query={list}>
            {(data) => (
              <DataTable
                caption={t('journal')}
                showCaption
                rowKey={(row) => row.id}
                rows={data.items}
                columns={columns}
                empty={<EmptyState icon="clipboard-list" title={t('empty')} />}
              />
            )}
          </QueryState>
        </Card>
      </div>
      <Dialog
        open={starting}
        onClose={() => setStarting(false)}
        title={t('startTitle')}
        closeLabel={tDocs('close')}
        size="md"
        footer={
          <>
            <Button variant="secondary" onClick={() => setStarting(false)}>
              {tDocs('cancel')}
            </Button>
            <Button
              loading={start.isPending}
              disabled={scope === 'category' && !categoryId}
              onClick={() => start.mutate()}
            >
              {t('startAction')}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <Select
            label={tDocs('store')}
            value={storeId}
            onChange={(event) => setStoreId(event.target.value)}
            options={access.writableStores.map((s) => ({
              value: s.id,
              label: s.name,
            }))}
          />
          <RadioCardGroup
            label={t('scope')}
            value={scope}
            onValueChange={setScope}
            columns={1}
            options={(['all', 'category'] as const).map((value) => ({
              value,
              title: t(`scopes.${value}`),
              description: t(`scopeHints.${value}`),
            }))}
          />
          {scope === 'category' && (
            <Select
              label={t('category')}
              placeholder={t('categoryPlaceholder')}
              value={categoryId}
              onChange={(event) => setCategoryId(event.target.value)}
              options={categories.map((c) => ({ value: c.id, label: c.name }))}
            />
          )}
          <p className="text-xs text-fg-subtle">{t('startHint')}</p>
        </div>
      </Dialog>
      {editing && (
        <StockCountEditor
          key={editing.id}
          document={editing}
          access={access}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}

export function StockCountsPage() {
  return (
    <WithMessages groups={['stock']}>
      <StockCountsPageView />
    </WithMessages>
  );
}
