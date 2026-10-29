'use client';

import type { ArticleListItem, ArticleStatus } from '@pharmacy/shared-dto';
import { formatDateTime } from '@pharmacy/shared-util';
import {
  Button,
  buttonClassName,
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
import { ArticleStatusPill, useArticleList } from '@/entities/site-content';
import { routes } from '@/shared/config';
import { QueryState } from '@/shared/ui';
import { PageHeader } from '@/widgets/app-shell';

const PAGE = 20;

type StatusFilter = 'all' | ArticleStatus;

const filters: StatusFilter[] = [
  'all',
  'draft',
  'published',
  'unpublished',
  'archived',
];

/**
 * «Сайт → Статьи»: the blog of the public site (ADR-0023). «Все» is the API's default list: everything except
 * the archive; the archive is a status of its own. The search runs on the API by the RU title.
 */
export function SiteArticlesPage() {
  const t = useTranslations('siteArticles');
  const tTable = useTranslations('table');
  const [filter, setFilter] = useState<StatusFilter>('all');
  const [search, setSearch] = useState('');
  const q = useDeferredValue(search.trim());
  const [offset, setOffset] = useState(0);
  const list = useArticleList({
    status: filter === 'all' ? undefined : filter,
    q: q || undefined,
    limit: PAGE,
    offset,
  });

  const showAll = () => {
    setFilter('all');
    setSearch('');
    setOffset(0);
  };

  const columns: DataTableColumn<ArticleListItem>[] = [
    {
      key: 'title',
      header: t('columns.title'),
      cell: (row) => (
        <div className="flex flex-col">
          <Link
            href={routes.siteArticle(row.id)}
            aria-label={t('open', { name: row.titleRu || row.slug })}
            className="font-medium text-fg hover:text-primary"
          >
            {row.titleRu || (
              <span className="text-fg-subtle">{t('noTitle')}</span>
            )}
          </Link>
          <span className="text-xs text-fg-subtle">{row.slug}</span>
        </div>
      ),
    },
    {
      key: 'status',
      header: t('columns.status'),
      nowrap: true,
      cell: (row) => <ArticleStatusPill status={row.status} />,
    },
    {
      key: 'locales',
      header: t('columns.locales'),
      nowrap: true,
      cell: (row) =>
        row.locales.length === 0
          ? '—'
          : row.locales
              .map((locale) => (locale === 'tg' ? 'TJ' : 'RU'))
              .join(' · '),
    },
    {
      key: 'publishedAt',
      header: t('columns.publishedAt'),
      nowrap: true,
      cell: (row) => (row.publishedAt ? formatDateTime(row.publishedAt) : '—'),
    },
    {
      key: 'updatedAt',
      header: t('columns.updatedAt'),
      nowrap: true,
      cell: (row) => formatDateTime(row.updatedAt),
    },
  ];

  return (
    <>
      <PageHeader
        title={t('title')}
        subtitle={t('subtitle')}
        actions={
          <Link
            href={routes.siteArticle()}
            className={buttonClassName({ variant: 'primary' })}
          >
            {t('create')}
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
                    icon="newspaper"
                    title={t('emptyTitle')}
                    description={t('emptyDescription')}
                    action={
                      <Button variant="tertiary" onClick={showAll}>
                        {t('showAll')}
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
