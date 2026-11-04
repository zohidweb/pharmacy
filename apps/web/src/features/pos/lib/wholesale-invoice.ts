/*
 * The A4 invoice of a wholesale receipt (spec 2026-11-03-pos-store-ideas, D27; plan 2026-11-03-pos-store-ideas-pr3,
 * R14): the paid receipt as an `InvoiceSheet` — the seller is the legal entity of the store, the buyer the organisation
 * of the receipt; a line carries its batch, expiry date, packs and price; the basis, the payment and the two signatures
 * go to the notes. Built from the receipt the till has just sold, as its printed receipt.
 */
import { receiptCode } from '@pharmacy/shared-domain';
import { formatDateOnly, formatMoney, toAppDate } from '@pharmacy/shared-util';
import type { InvoiceSheetProps } from '@pharmacy/ui';
import type { useTranslations } from 'use-intl';
import type { ReceiptPrintData } from './receipt-print';

export function wholesaleInvoiceSheet(
  { request, number, productNames, settings, batches }: ReceiptPrintData,
  t: ReturnType<typeof useTranslations<'pos'>>,
): InvoiceSheetProps {
  const money = (minor: number) => formatMoney(minor, { withSign: false });
  const buyer = request.wholesale ?? null;
  const date = formatDateOnly(toAppDate(new Date(request.occurredAt)));
  const title = number
    ? t('invoice.title', { number, date })
    : t('invoice.localTitle', {
        number: request.localNumber ?? '—',
        code: receiptCode(request.id),
        date,
      });
  return {
    title,
    parties: [
      {
        label: t('invoice.seller'),
        // a snapshot stored before the legal entity came with it: the network and the store address
        lines: [
          settings.legalEntityName ?? settings.networkName,
          t('invoice.taxId', { taxId: settings.taxId }),
          settings.legalAddress ?? settings.storeAddress,
        ],
      },
      {
        label: t('invoice.buyer'),
        lines: buyer
          ? [buyer.buyerName, t('invoice.taxId', { taxId: buyer.buyerTaxId })]
          : [],
      },
    ],
    columns: {
      line: t('invoice.columns.line'),
      detail: t('invoice.columns.detail'),
      amount: t('invoice.columns.amount'),
    },
    rows: request.lines.map((line) => {
      const batch = batches[line.batchId];
      return {
        line: productNames[line.productId] ?? line.productId,
        detail: t('invoice.detail', {
          batch: batch?.number || '—',
          expires: batch ? formatDateOnly(batch.expiresOn) : '—',
          quantity: line.quantity,
          price: money(line.unitPriceMinor),
        }),
        amount: money(line.amountMinor),
      };
    }),
    totals: [
      {
        label: t('invoice.total'),
        value: money(request.totalMinor),
        strong: true,
      },
    ],
    notes: [
      ...(buyer?.basis
        ? [{ label: t('invoice.basis'), value: buyer.basis }]
        : []),
      {
        label: t('invoice.payment'),
        value: request.payments
          .map((p) => `${t(`methods.${p.method}`)} ${money(p.amountMinor)}`)
          .join(', '),
      },
      { label: t('invoice.released'), value: t('invoice.signature') },
      { label: t('invoice.received'), value: t('invoice.signature') },
    ],
  };
}
