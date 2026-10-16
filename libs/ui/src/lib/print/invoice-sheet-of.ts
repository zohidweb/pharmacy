import type { InvoiceDetails } from '@pharmacy/shared-dto';
import {
  formatDateOnly,
  formatMoney,
  formatPercentBp,
  toAppDate,
} from '@pharmacy/shared-util';
import type { InvoiceSheetProps } from './InvoiceSheet';

/** The messages of an invoice sheet: the `invoicePrint` group of the admin and of the cabinet. */
export type InvoiceSheetMessage =
  | 'title'
  | 'period'
  | 'supplier'
  | 'payer'
  | 'inn'
  | 'account'
  | 'bik'
  | 'corrAccount'
  | 'columns.line'
  | 'columns.detail'
  | 'columns.amount'
  | 'storeDays'
  | 'discount'
  | 'providedOn'
  | 'net'
  | 'vat'
  | 'total'
  | 'dueOn'
  | 'purpose';

export type InvoiceSheetTranslate = (
  key: InvoiceSheetMessage,
  values?: Record<string, string | number>,
) => string;

/**
 * An invoice as a document (spec 2026-10-15-billing-services, A5): its snapshot — the requisites
 * and the payer at issue, the lines still on it — not the registry. One mapping for the admin and
 * the owner cabinet; the words come from the app's messages.
 */
export function invoiceSheetOf(
  invoice: InvoiceDetails,
  t: InvoiceSheetTranslate,
): InvoiceSheetProps {
  const { supplier, payer } = invoice;
  const [year, month] = invoice.period.split('-');
  return {
    title: t('title', {
      number: invoice.number,
      date: formatDateOnly(toAppDate(new Date(invoice.issuedAt))),
      period: t('period', { month: Number(month), year }),
    }),
    parties: [
      {
        label: t('supplier'),
        lines: [
          supplier.name,
          supplier.inn && t('inn', { inn: supplier.inn }),
          supplier.bankAccount &&
            t('account', { account: supplier.bankAccount }),
          supplier.bankName,
          supplier.bankBik && t('bik', { bik: supplier.bankBik }),
          supplier.bankCorrAccount &&
            t('corrAccount', { account: supplier.bankCorrAccount }),
        ].filter(Boolean),
      },
      {
        label: t('payer'),
        lines: [payer.name, payer.inn && t('inn', { inn: payer.inn })].filter(
          Boolean,
        ),
      },
    ],
    columns: {
      line: t('columns.line'),
      detail: t('columns.detail'),
      amount: t('columns.amount'),
    },
    rows: invoice.lines.map((line) => ({
      line: line.description,
      detail:
        line.kind === 'service'
          ? t('providedOn', { date: formatDateOnly(line.providedOn ?? '') })
          : [
              t('storeDays', {
                days: line.days ?? 0,
                daysInMonth: line.daysInMonth ?? 0,
                price: formatMoney(invoice.pricePerStoreMinor),
              }),
              line.discountBp
                ? t('discount', {
                    percent: formatPercentBp(line.discountBp),
                    amount: formatMoney(line.discountMinor ?? 0),
                  })
                : '',
            ]
              .filter(Boolean)
              .join(' · '),
      amount: formatMoney(line.amountMinor, { withSign: false }),
    })),
    totals: [
      { label: t('net'), value: formatMoney(invoice.netMinor) },
      {
        label: t('vat', { rate: invoice.vatRatePercent }),
        value: formatMoney(invoice.vatMinor),
      },
      {
        label: t('total'),
        value: formatMoney(invoice.totalMinor),
        strong: true,
      },
    ],
    notes: [
      { label: t('dueOn'), value: formatDateOnly(invoice.dueOn) },
      { label: t('purpose'), value: invoice.paymentPurpose },
    ],
  };
}
