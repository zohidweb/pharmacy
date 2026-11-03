'use client';

import { formatMoney } from '@pharmacy/shared-util';
import { Button, Dialog } from '@pharmacy/ui';
import { useTranslations } from 'use-intl';
import type { DisplayQr } from '@/shared/lib/customer-display';
import { QrSvg } from '@/shared/ui';

/**
 * The payment QR on the POS (spec 2026-11-03-pos-store-ideas, D40, R1): for a POS without a customer display, the
 * cashier turns the screen to the buyer. The payment is confirmed by «Оплатить» once it shows in the bank's app.
 */
export function PaymentQrDialog({
  qr,
  onClose,
}: {
  qr: DisplayQr;
  onClose: () => void;
}) {
  const t = useTranslations('pos.paymentQr');
  const amount = formatMoney(qr.amountMinor);
  return (
    <Dialog
      open
      onClose={onClose}
      title={t('title')}
      description={t('hint')}
      closeLabel={t('close')}
      size="md"
      footer={<Button onClick={onClose}>{t('close')}</Button>}
    >
      <figure className="m-0 flex flex-col items-center gap-3 text-center">
        <QrSvg
          text={qr.link}
          label={t('label')}
          className="w-(--ph-pay-qr-size) bg-surface"
        />
        <figcaption className="flex flex-col gap-1">
          <span className="text-lg font-bold">{qr.recipient}</span>
          {qr.withAmount ? (
            <span className="text-xl tabular-nums">
              {t('amount', { amount })}
            </span>
          ) : (
            <span className="text-2xl font-bold text-primary tabular-nums">
              {t('typeAmount', { amount })}
            </span>
          )}
        </figcaption>
      </figure>
    </Dialog>
  );
}
