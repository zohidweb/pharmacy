'use client';

import type { ConnectionRequestListItem } from '@pharmacy/shared-dto';
import { formatDateTime } from '@pharmacy/shared-util';
import {
  Button,
  Card,
  Chip,
  ChipGroup,
  DataTable,
  EmptyState,
  Pagination,
  TextField,
  type DataTableColumn,
} from '@pharmacy/ui';
import Link from 'next/link';
import { useDeferredValue, useState } from 'react';
import { useTranslations } from 'use-intl';
import {
  RequestStatusPill,
  useConnectionRequestList,
} from '@/entities/connection-request';
import { routes } from '@/shared/config';
import { QueryState } from '@/shared/ui';
import { PageHeader } from '@/widgets/app-shell';

const PAGE = 20;

type StatusFilter =
  'open' | 'new' | 'in_progress' | 'connected' | 'rejected' | 'spam' | 'all';

const filters: StatusFilter[] = [
  'open',
  'new',
  'in_progress',
  'connected',
  'rejected',
  'spam',
  'all',
];

/** The `status` of GET /operator/connection-requests: several statuses are separated by commas. */
const statusOf: Record<StatusFilter, string> = {
  open: 'new,in_progress',
  new: 'new',
  in_progress: 'in_progress',
  connected: 'connected',
  rejected: 'rejected',
  spam: 'spam',
  all: 'new,in_progress,connected,rejected,spam',
};

/**
 * «Сайт → Заявки»: connection requests of the public site (ADR-0023). The open ones (new and in work) by
 * default; the search runs on the API by the name of the network and the phone.
 */
export function SiteRequestsPage() {
  const t = useTranslations('siteRequests');
  const tTable = useTranslations('table');
  const [filter, setFilter] = useState<StatusFilter>('open');
  const [search, setSearch] = useState('');
  const q = useDeferredValue(search.trim());
  const [offset, setOffset] = useState(0);
  const list = useConnectionRequestList({
    status: statusOf[filter],
    q: q || undefined,
    limit: PAGE,
    offset,
  });

  const showOpen = () => {
    setFilter('open');
    setSearch('');
    setOffset(0);
  };

  const columns: DataTableColumn<ConnectionRequestListItem>[] = [
    {
      key: 'createdAt',
      header: t('columns.createdAt'),
      nowrap: true,
      cell: (row) => formatDateTime(row.createdAt),
    },
    {
      key: 'network',
      header: t('columns.network'),
      cell: (row) => (
        <div className="flex flex-col">
          <Link
            href={routes.siteRequest(row.id)}
            aria-label={t('open', { name: row.networkName })}
            className="font-medium text-fg hover:text-primary"
          >
            {row.networkName}
          </Link>
          <span className="text-xs text-fg-subtle">{row.city}</span>
        </div>
      ),
    },
    {
      key: 'contact',
      header: t('columns.contact'),
      cell: (row) =>
        row.contactName === null && row.phone === null ? (
          <span className="text-fg-subtle">{t('anonymized')}</span>
        ) : (
          <div className="flex flex-col">
            <span>{row.contactName}</span>
            <span className="text-xs text-fg-subtle tabular-nums">
              {row.phone}
            </span>
          </div>
        ),
    },
    {
      key: 'stores',
      header: t('columns.stores'),
      numeric: true,
      nowrap: true,
      cell: (row) => row.storeCount,
    },
    {
      key: 'status',
      header: t('columns.status'),
      nowrap: true,
      cell: (row) => <RequestStatusPill status={row.status} />,
    },
    {
      key: 'assignee',
      header: t('columns.assignee'),
      cell: (row) => row.assignedTo?.fullName ?? '—',
    },
  ];

  return (
    <>
      <PageHeader title={t('title')} subtitle={t('subtitle')} />
      <div className="flex flex-col gap-4 p-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <ChipGroup label={t('filterLabel')}>
            {filters.map((value) => (
              <Chip
                key={value}
                selected={filter === value}
                onClick={() => {
                  setFilter(value);
                  setOffset(0);
                }}
              >
                {t(`filters.${value}`)}
              </Chip>
            ))}
          </ChipGroup>
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
        </div>
        <QueryState query={list}>
          {(page) => (
            <Card padding="none">
              <DataTable
                caption={t('title')}
                columns={columns}
                rows={page.items}
                rowKey={(row) => row.id}
                minWidth="lg"
                empty={
                  <EmptyState
                    icon="inbox"
                    title={t('emptyTitle')}
                    description={t('emptyDescription')}
                    action={
                      <Button variant="tertiary" onClick={showOpen}>
                        {t('showOpen')}
                      </Button>
                    }
                  />
                }
              />
              {page.total > PAGE && (
                <Pagination
                  className="p-4"
                  offset={offset}
                  limit={PAGE}
                  total={page.total}
                  onOffsetChange={setOffset}
                  labels={{
                    nav: t('pagesLabel'),
                    previous: tTable('previous'),
                    next: tTable('next'),
                    range: (range) => tTable('range', range),
                  }}
                />
              )}
            </Card>
          )}
        </QueryState>
      </div>
    </>
  );
}
