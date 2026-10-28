'use client';

import {
  Alert,
  Button,
  Dialog,
  LabelPrint,
  type LabelSize,
  printDocument,
  Select,
  TextField,
} from '@pharmacy/ui';
import { useState } from 'react';
import { useTranslations } from 'use-intl';
import type { PriceTagData } from '../model/tag';
import { PriceTag } from './PriceTag';

const MAX_COPIES = 100;
const MAX_LABELS = 500;

export interface PrintTagsDialogProps {
  open: boolean;
  title: string;
  tags: readonly PriceTagData[];
  /** Pairs of the selection without a price at their store (T7). */
  skipped?: number;
  /** The store of a product card: its price goes on the tag (T6). */
  store?: {
    options: { value: string; label: string }[];
    value: string;
    onChange: (storeId: string) => void;
  };
  onClose: () => void;
}

/**
 * Printing price tags (UI mockup «Печать ценника», plan 2026-10-28-price-tags-qr, T5–T7): the size of the label stock,
 * the copies, a preview of the first tag at its real size; every tag × copy is a page of its own.
 */
export function PrintTagsDialog({
  open,
  title,
  tags,
  skipped = 0,
  store,
  onClose,
}: PrintTagsDialogProps) {
  const t = useTranslations('priceTags');
  const [size, setSize] = useState<LabelSize>('58x40');
  const [copies, setCopies] = useState('1');
  const count = Number(copies);
  const copiesValid =
    Number.isInteger(count) && count >= 1 && count <= MAX_COPIES;
  const total = copiesValid ? tags.length * count : 0;
  // one print is a roll of labels the browser lays out at once
  const tooMany = total > MAX_LABELS;
  const labels =
    copiesValid && !tooMany
      ? tags.flatMap((tag, i) =>
          Array.from({ length: count }, (_, copy) => ({
            key: `${i}-${copy}`,
            tag,
          })),
        )
      : [];
  // the tags of several stores carry different prices: the dialog says how many each store gets
  const perStore = [
    ...tags.reduce(
      (stores, tag) =>
        tag.store
          ? stores.set(tag.store, (stores.get(tag.store) ?? 0) + 1)
          : stores,
      new Map<string, number>(),
    ),
  ];

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      closeLabel={t('close')}
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('close')}
          </Button>
          <Button
            iconStart="printer"
            disabled={!copiesValid || tooMany || tags.length === 0}
            onClick={() => void printDocument()}
          >
            {t('print')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="grid gap-3 md:grid-cols-3">
          {store && (
            <Select
              label={t('store')}
              value={store.value}
              options={store.options}
              onChange={(event) => store.onChange(event.target.value)}
            />
          )}
          <Select
            label={t('size')}
            value={size}
            options={[
              { value: '58x40', label: t('size58x40') },
              { value: '40x30', label: t('size40x30') },
            ]}
            onChange={(event) => setSize(event.target.value as LabelSize)}
          />
          <TextField
            label={t('copies')}
            type="number"
            inputMode="numeric"
            min={1}
            max={MAX_COPIES}
            value={copies}
            onChange={(event) => setCopies(event.target.value)}
            error={copiesValid ? undefined : t('copiesRange')}
          />
        </div>
        {!store && (
          <p className="text-sm">
            {t('count', { count: tags.length, labels: total })}
          </p>
        )}
        {perStore.length > 1 && (
          <p className="text-sm">
            {t('perStore', {
              list: perStore
                .map(([name, n]) => t('storeCount', { store: name, count: n }))
                .join(', '),
            })}
          </p>
        )}
        {tooMany && (
          <Alert tone="warning">{t('tooMany', { max: MAX_LABELS })}</Alert>
        )}
        {skipped > 0 && (
          <Alert tone="warning">{t('skipped', { count: skipped })}</Alert>
        )}
        {tags[0] && (
          <figure
            aria-label={t('preview')}
            className="m-0 flex justify-center rounded-md bg-surface-sunken p-5"
          >
            <PriceTag tag={tags[0]} size={size} />
          </figure>
        )}
        <p className="text-xs text-fg-subtle">{t('hint')}</p>
      </div>
      {open && (
        <LabelPrint size={size}>
          {labels.map(({ key, tag }) => (
            <PriceTag key={key} tag={tag} size={size} />
          ))}
        </LabelPrint>
      )}
    </Dialog>
  );
}
