'use client';

import type {
  TenantListFilter,
  TenantListItem,
  TenantSortKey,
} from '@pharmacy/shared-dto';
import { formatDateOnly, formatMoney } from '@pharmacy/shared-util';
import {
  Alert,
  Avatar,
  Button,
  buttonClassName,
  Card,
  Chip,
  ChipGroup,
  DataTable,
  EmptyState,
  Icon,
  Pagination,
  SegmentedControl,
  Spinner,
  TextField,
  type DataTableColumn,
  type SortState,
} from '@pharmacy/ui';
import Link from 'next/link';
import { useDeferredValue, useState } from 'react';
import { useTranslations } from 'use-intl';
import { TenantStatusPill, useTenantList } from '@/entities/tenant';
import { ImpersonateTenant } from '@/features/impersonate-tenant';
import { useApiErrorMessage } from '@/shared/api';
import { routes } from '@/shared/config';
import { PageHeader } from '@/widgets/app-shell';

const PAGE_SIZE = 20;
const filters: TenantListFilter[] = ['all', 'active', 'unpaid', 'blocked'];

/** Registry of the platform's clients (UI mockup «Компании»). Filtering and sorting run on the API. */
export function CompaniesPage() {
  const t = useTranslations('companies');
  const tTable = useTranslations('table');
  const [filter, setFilter] = useState<TenantListFilter>('all');
  const [search, setSearch] = useState('');
  const q = useDeferredValue(search.trim());
  const [sort, setSort] = useState<SortState<TenantSortKey>>({
    key: 'name',
    direction: 'asc',
  });
  const [view, setView] = useState<'table' | 'cards'>('table');
  const [offset, setOffset] = useState(0);
  const list = useTenantList({
    filter,
    q: q || undefined,
    sort: sort.key,
    direction: sort.direction,
    limit: PAGE_SIZE,
    offset,
  });
  const errorMessage = useApiErrorMessage(list.error);
  const items = list.data?.items ?? [];

  const resetFilters = () => {
    setFilter('all');
    setSearch('');
    setOffset(0);
  };

  const columns: DataTableColumn<
    TenantListItem,
    TenantSortKey | 'status' | 'actions'
  >[] = [
    {
      key: 'name',
      header: t('columns.company'),
      sortable: true,
      cell: (tenant) => (
        <div className="flex flex-col">
          <Link
            href={routes.company(tenant.id)}
            className="font-medium text-fg hover:text-primary"
          >
            {tenant.name}
          </Link>
          <span className="text-xs text-fg-subtle">{tenant.city}</span>
        </div>
      ),
    },
    {
      key: 'owner',
      header: t('columns.owner'),
      sortable: true,
      cell: (tenant) => (
        <div className="flex flex-col">
          <span>{tenant.owner.fullName}</span>
          <span className="text-xs text-fg-subtle tabular-nums">
            {tenant.owner.phone}
          </span>
        </div>
      ),
    },
    {
      key: 'stores',
      header: t('columns.stores'),
      sortable: true,
      nowrap: true,
      cell: (tenant) =>
        t('storesSplit', {
          cloud: tenant.cloudStores,
          offline: tenant.offlineStores,
        }),
    },
    {
      key: 'paidUntil',
      header: t('columns.paidUntil'),
      sortable: true,
      nowrap: true,
      cell: (tenant) =>
        tenant.paidUntil ? formatDateOnly(tenant.paidUntil) : '—',
    },
    {
      key: 'status',
      header: t('columns.status'),
      nowrap: true,
      cell: (tenant) => <TenantStatusPill tenant={tenant} />,
    },
    {
      key: 'monthlyCharge',
      header: t('columns.monthlyCharge'),
      sortable: true,
      numeric: true,
      nowrap: true,
      cell: (tenant) =>
        formatMoney(tenant.monthlyChargeMinor, { withSign: false }),
    },
    {
      key: 'actions',
      header: <span className="ph-visually-hidden">{tTable('actions')}</span>,
      align: 'end',
      nowrap: true,
      cell: (tenant) => (
        <div className="flex items-center justify-end gap-1">
          <ImpersonateTenant
            tenant={tenant}
            appearance="icon"
            disabled={tenant.status === 'blocked'}
          />
          <Link
            href={routes.company(tenant.id)}
            aria-label={t('open', { name: tenant.name })}
            className="inline-grid size-(--ph-icon-button-size) place-items-center rounded-full text-fg-muted hover:bg-surface-sunken hover:text-fg"
          >
            <Icon name="chevron-right" size="md" />
          </Link>
        </div>
      ),
    },
  ];

  const empty = (
    <EmptyState
      title={t('emptyTitle')}
      description={t('emptyDescription')}
      action={
        <Button variant="tertiary" onClick={resetFilters}>
          {t('showAll')}
        </Button>
      }
    />
  );

  return (
    <>
      <PageHeader
        title={t('title')}
        subtitle={
          list.data
            ? t('subtitle', { companies: list.data.counts.all })
            : undefined
        }
        actions={
          <Link href={routes.companyCreate()} className={buttonClassName({})}>
            <Icon name="plus" size="sm" />
            <span>{t('create')}</span>
          </Link>
        }
      />
      <div className="flex flex-col gap-4 p-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <ChipGroup label={t('filterLabel')}>
            {filters.map((value) => (
              <Chip
                key={value}
                selected={filter === value}
                count={list.data?.counts[value]}
                onClick={() => {
                  setFilter(value);
                  setOffset(0);
                }}
              >
                {t(`filters.${value}`)}
              </Chip>
            ))}
          </ChipGroup>
          <div className="flex items-end gap-3">
            <TextField
              label={t('search')}
              hideLabel
              type="search"
              placeholder={t('searchPlaceholder')}
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setOffset(0);
              }}
              className="w-(--ph-size-dialog-sm)"
            />
            <SegmentedControl
              label={t('viewLabel')}
              value={view}
              onValueChange={setView}
              options={[
                { value: 'table', label: t('viewTable') },
                { value: 'cards', label: t('viewCards') },
              ]}
            />
          </div>
        </div>

        {errorMessage && (
          <Alert tone="danger" live="assertive">
            {errorMessage}
          </Alert>
        )}

        {list.isPending ? (
          <div className="grid place-items-center py-12 text-primary">
            <Spinner size="xl" label={t('loading')} />
          </div>
        ) : view === 'table' ? (
          <Card padding="none">
            <DataTable
              caption={t('title')}
              columns={columns}
              rows={items}
              rowKey={(tenant) => tenant.id}
              sort={sort}
              onSortChange={(next) => {
                setSort(next as SortState<TenantSortKey>);
                setOffset(0);
              }}
              sortLabel={(direction) => tTable(`sort.${direction}`)}
              empty={empty}
              minWidth="lg"
            />
          </Card>
        ) : items.length === 0 ? (
          <Card>{empty}</Card>
        ) : (
          <ul className="m-0 grid list-none grid-cols-3 gap-4 p-0">
            {items.map((tenant) => (
              <li key={tenant.id}>
                <Card as="article" className="flex h-full flex-col gap-4">
                  <div className="flex items-start gap-3">
                    <Avatar name={tenant.name} />
                    <div className="flex min-w-0 flex-1 flex-col">
                      <Link
                        href={routes.company(tenant.id)}
                        className="truncate font-bold text-fg hover:text-primary"
                      >
                        {tenant.name}
                      </Link>
                      <span className="truncate text-xs text-fg-subtle">
                        {tenant.city} · {tenant.owner.fullName}
                      </span>
                    </div>
                    <TenantStatusPill tenant={tenant} />
                  </div>
                  <dl className="m-0 grid grid-cols-3 gap-2">
                    {(
                      [
                        ['cloud', tenant.cloudStores],
                        ['offline', tenant.offlineStores],
                        ['month', formatMoney(tenant.monthlyChargeMinor)],
                      ] as const
                    ).map(([key, value]) => (
                      <div
                        key={key}
                        className="flex flex-col rounded-md bg-surface-sunken p-3"
                      >
                        <dt className="text-2xs text-fg-subtle">
                          {t(`card.${key}`)}
                        </dt>
                        <dd className="m-0 text-sm font-bold tabular-nums">
                          {value}
                        </dd>
                      </div>
                    ))}
                  </dl>
                  <p className="flex items-center gap-2 text-xs text-fg-muted">
                    <Icon name="calendar-check" size="sm" />
                    {t('columns.paidUntil')}:{' '}
                    {tenant.paidUntil ? formatDateOnly(tenant.paidUntil) : '—'}
                  </p>
                  <div className="mt-auto flex items-center justify-between gap-2">
                    <ImpersonateTenant
                      tenant={tenant}
                      disabled={tenant.status === 'blocked'}
                    />
                    <Link
                      href={routes.company(tenant.id)}
                      className={buttonClassName({ variant: 'tertiary' })}
                    >
                      {t('openShort')}
                    </Link>
                  </div>
                </Card>
              </li>
            ))}
          </ul>
        )}

        {list.data && list.data.total > PAGE_SIZE && (
          <Pagination
            offset={offset}
            limit={PAGE_SIZE}
            total={list.data.total}
            onOffsetChange={setOffset}
            labels={{
              nav: t('pagesLabel'),
              previous: tTable('previous'),
              next: tTable('next'),
              range: (range) => tTable('range', range),
            }}
          />
        )}
      </div>
    </>
  );
}
