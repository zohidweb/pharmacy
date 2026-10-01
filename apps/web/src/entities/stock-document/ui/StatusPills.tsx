'use client';

import type { StockState } from '@pharmacy/shared-domain';
import type {
  ClaimStatus,
  DocumentStatus,
  TransferRequestStatus,
  TransferStatus,
} from '@pharmacy/shared-dto';
import { StatusPill, type IconName, type StatusTone } from '@pharmacy/ui';
import { useTranslations } from 'use-intl';

/** Draft / posted of a stock document; a stock count in progress is a draft too. */
export function DocumentStatusPill({
  status,
}: {
  status: DocumentStatus | 'in_progress';
}) {
  const t = useTranslations('stockDocs.status');
  return status === 'posted' ? (
    <StatusPill tone="success">{t('posted')}</StatusPill>
  ) : (
    <StatusPill tone="neutral" icon="pencil">
      {t(status)}
    </StatusPill>
  );
}

const stockTone: Record<StockState, StatusTone> = {
  ok: 'success',
  low: 'warning',
  expiring: 'attention',
  out: 'neutral',
  negative: 'danger',
};

/** State of a stock row (UI mockup «Остатки»): icon + text, never color alone. */
export function StockStatePill({ state }: { state: StockState }) {
  const t = useTranslations('stock.state');
  return (
    <StatusPill
      tone={stockTone[state]}
      icon={state === 'out' ? 'ban' : undefined}
    >
      {t(state)}
    </StatusPill>
  );
}

const requestTone: Record<
  TransferRequestStatus,
  [StatusTone, IconName | null]
> = {
  draft: ['neutral', 'pencil'],
  sent: ['info', 'arrow-up'],
  in_progress: ['attention', 'clock'],
  partial: ['warning', 'triangle-alert'],
  done: ['success', 'circle-check'],
  rejected: ['danger', 'ban'],
};

export function RequestStatusPill({
  status,
}: {
  status: TransferRequestStatus;
}) {
  const t = useTranslations('transfers.requestStatus');
  const [tone, icon] = requestTone[status];
  return (
    <StatusPill tone={tone} icon={icon}>
      {t(status)}
    </StatusPill>
  );
}

const transferTone: Record<TransferStatus, [StatusTone, IconName | null]> = {
  draft: ['neutral', 'pencil'],
  in_transit: ['info', 'truck'],
  awaiting: ['attention', 'refresh-cw'],
  accepted: ['success', 'circle-check'],
};

export function TransferStatusPill({ status }: { status: TransferStatus }) {
  const t = useTranslations('transfers.status');
  const [tone, icon] = transferTone[status];
  return (
    <StatusPill tone={tone} icon={icon}>
      {t(status)}
    </StatusPill>
  );
}

export function ClaimStatusPill({ claim }: { claim: ClaimStatus }) {
  const t = useTranslations('supplierReturns.claim');
  if (claim === 'none') return <span className="text-fg-subtle">—</span>;
  return (
    <StatusPill
      tone={
        claim === 'accepted' ? 'success' : claim === 'sent' ? 'info' : 'neutral'
      }
      icon={null}
    >
      {t(claim)}
    </StatusPill>
  );
}
