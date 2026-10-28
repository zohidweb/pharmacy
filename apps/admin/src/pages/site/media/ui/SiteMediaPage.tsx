'use client';

import type { SiteMedia } from '@pharmacy/shared-dto';
import {
  Alert,
  Button,
  Card,
  DataTable,
  EmptyState,
  Pagination,
  type DataTableColumn,
} from '@pharmacy/ui';
import { formatDateTime } from '@pharmacy/shared-util';
import { useState } from 'react';
import { useTranslations } from 'use-intl';
import {
  siteMediaContentUrl,
  siteMediaEmbed,
  useSiteMediaList,
  useSiteMediaSizeText,
} from '@/entities/site-content';
import { UploadSiteMediaButton } from '@/features/site-media';
import { QueryState } from '@/shared/ui';
import { PageHeader } from '@/widgets/app-shell';

const PAGE = 20;

const typeLabel: Record<SiteMedia['contentType'], string> = {
  'image/png': 'PNG',
  'image/jpeg': 'JPEG',
  'image/webp': 'WebP',
};

/**
 * «Сайт → Картинки»: the library of the pictures of the site (ADR-0023). Pictures are never deleted (the API
 * has no such route); an article refers to one as `![caption](media:<id>)`, the page copies that line.
 */
export function SiteMediaPage() {
  const t = useTranslations('siteMedia');
  const tMedia = useTranslations('site.media');
  const tTable = useTranslations('table');
  const sizeText = useSiteMediaSizeText();
  const [offset, setOffset] = useState(0);
  const [copied, setCopied] = useState<{ id: string; ok: boolean } | null>(
    null,
  );
  const list = useSiteMediaList({ limit: PAGE, offset });

  const copy = (media: SiteMedia) => {
    // No clipboard outside a secure context, or the permission is denied.
    const write = navigator.clipboard?.writeText(siteMediaEmbed(media));
    if (!write) {
      setCopied({ id: media.id, ok: false });
      return;
    }
    write.then(
      () => setCopied({ id: media.id, ok: true }),
      () => setCopied({ id: media.id, ok: false }),
    );
  };

  const columns: DataTableColumn<SiteMedia>[] = [
    {
      key: 'preview',
      header: t('columns.preview'),
      cell: (row) => (
        <img
          src={siteMediaContentUrl(row.id)}
          alt=""
          loading="lazy"
          className="size-12 rounded-sm border border-border bg-surface-sunken object-contain"
        />
      ),
    },
    {
      key: 'alt',
      header: t('columns.alt'),
      cell: (row) =>
        row.alt || (
          <span className="text-fg-subtle">{tMedia('noCaption')}</span>
        ),
    },
    {
      key: 'type',
      header: t('columns.type'),
      nowrap: true,
      cell: (row) => typeLabel[row.contentType],
    },
    {
      key: 'size',
      header: t('columns.size'),
      numeric: true,
      nowrap: true,
      cell: (row) => sizeText(row.byteSize),
    },
    {
      key: 'pixels',
      header: t('columns.pixels'),
      numeric: true,
      nowrap: true,
      cell: (row) => `${row.width} × ${row.height}`,
    },
    {
      key: 'createdAt',
      header: t('columns.createdAt'),
      nowrap: true,
      cell: (row) => formatDateTime(row.createdAt),
    },
    {
      key: 'copy',
      header: t('columns.copy'),
      align: 'end',
      nowrap: true,
      cell: (row) => (
        <Button
          variant="tertiary"
          iconStart={copied?.id === row.id && copied.ok ? 'check' : 'link'}
          onClick={() => copy(row)}
          aria-label={t('copyFor', { name: row.alt || tMedia('noCaption') })}
        >
          {copied?.id === row.id && copied.ok ? t('copied') : t('copy')}
        </Button>
      ),
    },
  ];

  return (
    <>
      <PageHeader title={t('title')} subtitle={t('subtitle')} />
      <div className="flex flex-col gap-4 p-6">
        <UploadSiteMediaButton
          variant="primary"
          onUploaded={() => setOffset(0)}
        />
        {copied && !copied.ok && (
          <Alert tone="danger" live="assertive">
            {t('copyFailed')}
          </Alert>
        )}
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
                    icon="image"
                    title={t('emptyTitle')}
                    description={t('emptyDescription')}
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
              <p className="border-t border-border px-(--ph-table-cell-padding-x) py-3 text-xs text-fg-subtle">
                {t('note')}
              </p>
            </Card>
          )}
        </QueryState>
      </div>
    </>
  );
}
