'use client';

import type { StockDocumentKind } from '@pharmacy/shared-dto';
import { formatDateTime } from '@pharmacy/shared-util';
import { Alert, Button, Dialog, Spinner } from '@pharmacy/ui';
import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'use-intl';
import { apiRequest, useApiErrorMessage } from '@/shared/api';

/**
 * Unposting of a posted document (ТЗ): back to a draft, the stock is restored; blocked when a batch
 * of the document moved later (sales, transfers) — the reasons are shown, there is no bypass.
 */
export function UnpostDialog({
  kind,
  id,
  number,
  busy,
  error,
  onConfirm,
  onClose,
}: {
  kind: StockDocumentKind;
  id: string | null;
  number: string;
  busy: boolean;
  error: unknown;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const t = useTranslations('stockDocs.unpost');
  const check = useQuery({
    queryKey: ['unpost-check', kind, id],
    queryFn: ({ signal }) =>
      apiRequest('documents.unpostCheck', {
        params: { kind, id: id ?? '' },
        signal,
      }),
    enabled: id !== null,
    staleTime: 0,
  });
  const message = useApiErrorMessage(error);
  const data = check.data;
  return (
    <Dialog
      open={id !== null}
      onClose={onClose}
      title={t('title')}
      description={number}
      closeLabel={t('close')}
      icon="undo-2"
      tone="warning"
      size="md"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('close')}
          </Button>
          <Button
            variant="destructive"
            loading={busy}
            disabled={!data?.allowed}
            onClick={onConfirm}
          >
            {t('confirm')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <p className="text-sm">{t('question')}</p>
        {check.isPending ? (
          <div className="grid place-items-center py-4 text-primary">
            <Spinner size="lg" label={t('checking')} />
          </div>
        ) : data ? (
          <>
            <dl className="m-0 flex flex-col gap-1 text-sm">
              {data.postedBy && (
                <div className="flex justify-between gap-4">
                  <dt className="text-fg-subtle">{t('postedAt')}</dt>
                  <dd className="m-0">
                    {formatDateTime(data.postedBy.at)} · {data.postedBy.name}
                  </dd>
                </div>
              )}
              <div className="flex justify-between gap-4">
                <dt className="text-fg-subtle">{t('stockEffect')}</dt>
                <dd className="m-0">{t('stockWillRevert')}</dd>
              </div>
            </dl>
            {!data.allowed && (
              <Alert tone="danger" title={t('blocked')}>
                <ul className="m-0 flex list-none flex-col gap-1 p-0">
                  {data.blockers.map((blocker) => (
                    <li key={blocker.batchNumber}>
                      {t('blockedWhy', {
                        batch: blocker.batchNumber,
                        product: blocker.productName,
                        sold: blocker.soldPieces,
                        documents: blocker.documents.join(', ') || '—',
                      })}
                    </li>
                  ))}
                </ul>
              </Alert>
            )}
          </>
        ) : null}
        {message && (
          <Alert tone="danger" live="assertive">
            {message}
          </Alert>
        )}
        <p className="text-xs text-fg-subtle">{t('auditHint')}</p>
      </div>
    </Dialog>
  );
}
