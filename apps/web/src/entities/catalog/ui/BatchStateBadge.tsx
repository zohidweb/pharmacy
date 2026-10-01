'use client';

import type { PrescriptionKind } from '@pharmacy/shared-dto';
import { StatusPill, type StatusTone } from '@pharmacy/ui';
import { useTranslations } from 'use-intl';
import type { BatchState } from '../model/catalog-index';

const batchTone: Record<BatchState, StatusTone> = {
  ok: 'success',
  expiring: 'warning',
  expired: 'danger',
  empty: 'neutral',
};

/** Expiry state of a batch: icon + text (Iron Law 3, glossary «Партия»). */
export function BatchStateBadge({ state }: { state: BatchState }) {
  const t = useTranslations('catalog.batchState');
  return <StatusPill tone={batchTone[state]}>{t(state)}</StatusPill>;
}

/** Prescription marker: «Рецептурный» or «ПКУ»; nothing for OTC products. */
export function PrescriptionBadge({ kind }: { kind: PrescriptionKind }) {
  const t = useTranslations('catalog.prescription');
  if (kind === 'none') return null;
  return (
    <StatusPill
      tone={kind === 'controlled' ? 'danger' : 'attention'}
      icon={kind === 'controlled' ? 'lock' : 'file-text'}
    >
      {t(kind)}
    </StatusPill>
  );
}
