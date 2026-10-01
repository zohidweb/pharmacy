'use client';

import {
  Alert,
  Button,
  Dialog,
  printReceipt,
  RECEIPT_COLUMNS,
  ReceiptPreview,
  ReceiptPrint,
  SegmentedControl,
  type PaperWidth,
} from '@pharmacy/ui';
import { useState } from 'react';
import { useTranslations } from 'use-intl';
import {
  saleReceiptLines,
  type ReceiptLabels,
  type ReceiptPrintData,
} from '../lib/receipt-print';

export function useReceiptLabels(): ReceiptLabels {
  const t = useTranslations('pos.print');
  const tPos = useTranslations('pos');
  return {
    receipt: (number) => t('receipt', { number }),
    pendingNumber: t('pendingNumber'),
    cashier: t('cashier'),
    subtotal: tPos('subtotal'),
    discount: (percent) => tPos('discount', { percent }),
    total: t('total'),
    change: tPos('change'),
    tendered: t('tendered'),
    method: {
      cash: tPos('methods.cash'),
      card: tPos('methods.card'),
      qr: tPos('methods.qr'),
      nfc: tPos('methods.nfc'),
    },
    unit: { pack: tPos('units.pack'), piece: tPos('units.piece') },
    fiscalPlaceholder: t('fiscalPlaceholder'),
    taxId: t('taxId'),
  };
}

/** After «Оплатить»: the receipt preview, paper width and printing; the next sale starts at once. */
export function SaleReceiptDialog({
  data,
  onClose,
}: {
  data: ReceiptPrintData | null;
  onClose: () => void;
}) {
  const t = useTranslations('pos.print');
  const tPos = useTranslations('pos');
  const labels = useReceiptLabels();
  const [paper, setPaper] = useState<PaperWidth>('80');
  const lines = data
    ? saleReceiptLines(data, labels, RECEIPT_COLUMNS[paper])
    : [];
  return (
    <Dialog
      open={data !== null}
      onClose={onClose}
      title={t('title')}
      description={
        data?.number
          ? t('receipt', { number: data.number })
          : t('pendingNumber')
      }
      closeLabel={tPos('close')}
      size="md"
      footer={
        <>
          <SegmentedControl
            label={t('paper')}
            value={paper}
            onValueChange={setPaper}
            options={[
              { value: '80', label: '80 мм' },
              { value: '58', label: '58 мм' },
            ]}
          />
          <Button variant="secondary" onClick={onClose}>
            {t('next')}
          </Button>
          <Button iconStart="printer" onClick={() => void printReceipt()}>
            {t('print')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col items-center gap-3">
        {data && !data.number && (
          <Alert tone="warning" className="self-stretch">
            {t('buffered')}
          </Alert>
        )}
        <ReceiptPreview lines={lines} paperWidth={paper} label={t('preview')} />
        {data && <ReceiptPrint lines={lines} paperWidth={paper} />}
      </div>
    </Dialog>
  );
}
