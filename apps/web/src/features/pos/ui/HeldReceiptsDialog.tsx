'use client';

import type { HeldReceipt } from '@pharmacy/shared-dto';
import { formatDateTime, formatMoney } from '@pharmacy/shared-util';
import { Alert, Button, Dialog, EmptyState, IconButton } from '@pharmacy/ui';
import { useTranslations } from 'use-intl';
import { useApiErrorMessage } from '@/shared/api';

/**
 * Held receipts of the store (ТЗ): visible to every cashier of the store, deleted when the shift
 * closes. They live on the server, so the list needs a connection.
 */
export function HeldReceiptsDialog({
  open,
  items,
  error,
  offline,
  onResume,
  onDelete,
  onClose,
}: {
  open: boolean;
  items: HeldReceipt[] | undefined;
  error: unknown;
  offline: boolean;
  onResume: (held: HeldReceipt) => void;
  onDelete: (held: HeldReceipt) => void;
  onClose: () => void;
}) {
  const t = useTranslations('pos.held');
  const tPos = useTranslations('pos');
  const message = useApiErrorMessage(error);
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t('title')}
      description={t('subtitle')}
      closeLabel={tPos('close')}
      size="md"
    >
      <div className="flex flex-col gap-3">
        {offline && <Alert tone="warning">{t('offline')}</Alert>}
        {message && !offline && (
          <Alert tone="danger" live="assertive">
            {message}
          </Alert>
        )}
        {items && items.length === 0 && (
          <EmptyState icon="pause" title={t('empty')} />
        )}
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {items?.map((held) => (
            <li
              key={held.id}
              className="flex items-center gap-3 rounded-md border border-border p-3"
            >
              <span className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="text-sm font-medium">
                  {tPos('positions', { count: held.lines.length })} ·{' '}
                  {held.lines.map((line) => line.productName).join(', ')}
                </span>
                <span className="text-xs text-fg-subtle">
                  {t('heldBy', {
                    at: formatDateTime(held.heldAt),
                    name: held.heldBy,
                  })}
                </span>
              </span>
              <b className="tabular-nums">{formatMoney(held.subtotalMinor)}</b>
              <Button onClick={() => onResume(held)}>{t('resume')}</Button>
              <IconButton
                icon="trash-2"
                label={t('delete')}
                variant="surface"
                onClick={() => onDelete(held)}
              />
            </li>
          ))}
        </ul>
        <p className="text-xs text-fg-subtle">{t('hint')}</p>
      </div>
    </Dialog>
  );
}
