'use client';

import type { SiteMedia, SiteMediaType } from '@pharmacy/shared-dto';
import { Dialog, EmptyState, Pagination, TextField } from '@pharmacy/ui';
import { useState } from 'react';
import { useTranslations } from 'use-intl';
import {
  siteMediaContentUrl,
  siteMediaTypes,
  useSiteMediaList,
} from '@/entities/site-content';
import { QueryState } from '@/shared/ui';
import { UploadSiteMediaButton } from './UploadSiteMediaButton';

const PAGE = 12;

export interface SiteMediaPickerDialogProps {
  open: boolean;
  onClose: () => void;
  /** The picture the operator chose, or has just uploaded from the dialog. */
  onPick: (media: SiteMedia) => void;
  /** Types the caller can use (a favicon: PNG and WebP); all three by default. */
  accept?: readonly SiteMediaType[];
}

/**
 * The picture picker shared by the article editor and the site settings (spec 2026-10-28-public-site-design,
 * S8): the library page by page, a search by caption among the pictures of the shown page, an upload on the
 * spot. A click on a picture picks it and closes the dialog.
 */
export function SiteMediaPickerDialog({
  open,
  onClose,
  onPick,
  accept = siteMediaTypes,
}: SiteMediaPickerDialogProps) {
  const t = useTranslations('site.media');
  const tCommon = useTranslations('common');
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t('picker.title')}
      description={t('picker.description')}
      closeLabel={tCommon('close')}
      size="lg"
    >
      {/* Mounted only while open: the library is fetched on demand and the search starts empty each time. */}
      {open && <PickerBody onClose={onClose} onPick={onPick} accept={accept} />}
    </Dialog>
  );
}

function PickerBody({
  onClose,
  onPick,
  accept,
}: Pick<SiteMediaPickerDialogProps, 'onClose' | 'onPick'> & {
  accept: readonly SiteMediaType[];
}) {
  const t = useTranslations('site.media');
  const tTable = useTranslations('table');
  const [offset, setOffset] = useState(0);
  const [search, setSearch] = useState('');
  const list = useSiteMediaList({ limit: PAGE, offset });

  const pick = (media: SiteMedia) => {
    onPick(media);
    onClose();
  };
  const needle = search.trim().toLowerCase();

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <TextField
          label={t('picker.search')}
          hint={t('picker.searchHint')}
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          className="w-(--ph-size-dialog-sm)"
        />
        <UploadSiteMediaButton onUploaded={pick} accept={accept} />
      </div>
      <QueryState query={list}>
        {(page) => {
          const shown = page.items.filter(
            (media) =>
              accept.includes(media.contentType) &&
              media.alt.toLowerCase().includes(needle),
          );
          return (
            <>
              {shown.length === 0 ? (
                <EmptyState
                  icon="image"
                  title={
                    page.total === 0
                      ? t('picker.emptyTitle')
                      : t('picker.noMatchTitle')
                  }
                  description={
                    page.total === 0
                      ? t('picker.emptyDescription')
                      : t('picker.noMatchDescription')
                  }
                />
              ) : (
                <ul className="m-0 grid list-none grid-cols-3 gap-3 p-0">
                  {shown.map((media) => (
                    <li key={media.id} className="min-w-0">
                      <button
                        type="button"
                        onClick={() => pick(media)}
                        aria-label={t('picker.pick', {
                          name: media.alt || t('noCaption'),
                        })}
                        className="flex w-full min-w-0 flex-col gap-2 rounded-md border border-border bg-surface p-2 text-start transition-colors hover:border-primary hover:bg-surface-sunken"
                      >
                        <img
                          src={siteMediaContentUrl(media.id)}
                          alt=""
                          loading="lazy"
                          className="aspect-square w-full rounded-sm bg-surface-sunken object-contain"
                        />
                        <span className="truncate text-xs text-fg-muted">
                          {media.alt || t('noCaption')}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {page.total > PAGE && (
                <Pagination
                  offset={offset}
                  limit={PAGE}
                  total={page.total}
                  onOffsetChange={setOffset}
                  labels={{
                    nav: t('picker.pagesLabel'),
                    previous: tTable('previous'),
                    next: tTable('next'),
                    range: (range) => tTable('range', range),
                  }}
                />
              )}
            </>
          );
        }}
      </QueryState>
    </div>
  );
}
