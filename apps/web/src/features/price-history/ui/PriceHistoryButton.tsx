'use client';

import { IconButton } from '@pharmacy/ui';
import { useState } from 'react';
import { useTranslations } from 'use-intl';
import {
  PriceHistoryDialog,
  type PriceHistoryDialogProps,
} from './PriceHistoryDialog';

/** «История цен» of a product: an icon button that opens the history (spec 2026-11-03-pos-store-ideas, D14). */
export function PriceHistoryButton(
  props: Omit<PriceHistoryDialogProps, 'onClose'>,
) {
  const t = useTranslations('pricing.history');
  const [open, setOpen] = useState(false);
  return (
    <>
      <IconButton
        icon="clock"
        label={t('open', { name: props.productName })}
        variant="ghost"
        onClick={() => setOpen(true)}
      />
      {open && <PriceHistoryDialog {...props} onClose={() => setOpen(false)} />}
    </>
  );
}
