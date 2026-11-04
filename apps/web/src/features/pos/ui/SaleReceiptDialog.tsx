'use client';

import {
  Alert,
  Button,
  Dialog,
  InvoiceSheet,
  printDocument,
  printReceipt,
  RECEIPT_COLUMNS,
  ReceiptPreview,
  ReceiptPrint,
  SegmentedControl,
  SheetPrint,
  type PaperWidth,
} from '@pharmacy/ui';
import { receiptCode } from '@pharmacy/shared-domain';
import { useEffect, useState } from 'react';
import { useTranslations } from 'use-intl';
import { QrSvg } from '@/shared/ui';
import {
  saleReceiptLines,
  type ReceiptLabels,
  type ReceiptPrintData,
} from '../lib/receipt-print';
import { wholesaleInvoiceSheet } from '../lib/wholesale-invoice';

/** The A4 sheet is printed once its print root is in the document (SheetPrint mounts it after a render). */
function whenSheetMounted(print: () => void, tries = 20) {
  if (document.querySelector('.ph-print-sheet') || tries === 0) print();
  else setTimeout(() => whenSheetMounted(print, tries - 1), 16);
}

export function useReceiptLabels(): ReceiptLabels {
  const t = useTranslations('pos.print');
  const tPos = useTranslations('pos');
  return {
    receipt: (number) => t('receipt', { number }),
    pendingNumber: t('pendingNumber'),
    localNumber: (number, code) => t('localNumber', { number, code }),
    serverNumberLater: t('serverNumberLater'),
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
    wholesale: t('wholesale'),
    buyer: (name) => t('buyer', { name }),
    buyerTaxId: (taxId) => t('buyerTaxId', { taxId }),
    basis: (basis) => t('basis', { basis }),
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
  // one print root at a time (`.ph-print-root`): the receipt, or the A4 invoice of a wholesale receipt while it prints
  // (plan 2026-11-03-pos-store-ideas-pr3, R14)
  const [printing, setPrinting] = useState<'receipt' | 'sheet'>('receipt');
  const wholesale = Boolean(data?.request.wholesale);
  useEffect(() => {
    if (printing !== 'sheet') return;
    const back = () => setPrinting('receipt');
    window.addEventListener('afterprint', back, { once: true });
    whenSheetMounted(() => void printDocument());
    return () => window.removeEventListener('afterprint', back);
  }, [printing]);
  const lines = data
    ? saleReceiptLines(data, labels, RECEIPT_COLUMNS[paper])
    : [];
  // the QR of the receipt id (ADR-0022): the till knows it before the server, the return screen finds the receipt by it
  const qr = data ? (
    <QrSvg text={data.request.id} label={t('qr')} className="ph-receipt-qr" />
  ) : null;
  return (
    <Dialog
      open={data !== null}
      onClose={onClose}
      title={t('title')}
      description={
        data?.number
          ? t('receipt', { number: data.number })
          : data?.request.localNumber
            ? t('localNumber', {
                number: data.request.localNumber,
                code: receiptCode(data.request.id),
              })
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
          {wholesale && (
            <Button
              variant="secondary"
              iconStart="file-text"
              onClick={() => setPrinting('sheet')}
            >
              {tPos('invoice.print')}
            </Button>
          )}
          <Button
            iconStart="printer"
            disabled={printing === 'sheet'}
            onClick={() => void printReceipt()}
          >
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
        <ReceiptPreview
          lines={lines}
          paperWidth={paper}
          label={t('preview')}
          after={qr}
        />
        {data && printing === 'receipt' && (
          <ReceiptPrint lines={lines} paperWidth={paper} after={qr} />
        )}
        {data && printing === 'sheet' && (
          <SheetPrint>
            <InvoiceSheet {...wholesaleInvoiceSheet(data, tPos)} />
          </SheetPrint>
        )}
      </div>
    </Dialog>
  );
}
