'use client';

import type { InvoiceDetails } from '@pharmacy/shared-dto';
import { formatDateOnly, formatMoney, toAppDate } from '@pharmacy/shared-util';
import {
  Button,
  Card,
  Icon,
  InvoiceSheet,
  type InvoiceSheetProps,
  printReceipt,
  SheetPrint,
  Spinner,
} from '@pharmacy/ui';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { useTranslations } from 'use-intl';
import { billingKeys } from '@/entities/invoice';
import { apiRequest } from '@/shared/api';
import { routes } from '@/shared/config';
import { QueryState } from '@/shared/ui';
import { PageHeader } from '@/widgets/app-shell';

type Translate = ReturnType<typeof useTranslations<'invoicePrint'>>;

/** The invoice as a document (spec 2026-10-15-billing-services, 6.3): its snapshot, not the registry. */
function toSheet(invoice: InvoiceDetails, t: Translate): InvoiceSheetProps {
  const { supplier, payer } = invoice;
  return {
    title: t('title', {
      number: invoice.number,
      date: formatDateOnly(toAppDate(new Date(invoice.issuedAt))),
      period: formatDateOnly(`${invoice.period}-01`).slice(3),
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
                    percent: `${line.discountBp / 100}`.replace('.', ','),
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

function InvoicePrintView() {
  const t = useTranslations('invoicePrint');
  const id = useSearchParams()?.get('id') ?? '';
  const invoice = useQuery({
    queryKey: billingKeys.invoice(id),
    queryFn: ({ signal }) =>
      apiRequest('invoices.get', { params: { id }, signal }),
    enabled: id !== '',
  });
  return (
    <>
      <PageHeader
        title={
          invoice.data
            ? t('heading', { number: invoice.data.number })
            : t('pageTitle')
        }
        actions={
          <Button
            iconStart="printer"
            disabled={!invoice.data}
            onClick={() => void printReceipt()}
          >
            {t('print')}
          </Button>
        }
      />
      <div className="flex flex-col gap-4 p-6">
        <Link
          href={routes.invoices()}
          className="inline-flex items-center gap-1 self-start text-sm text-primary hover:text-primary-hover"
        >
          <Icon name="arrow-left" size="sm" />
          {t('back')}
        </Link>
        <QueryState query={invoice}>
          {(data) => {
            const sheet = toSheet(data, t);
            return (
              <>
                <Card className="max-w-(--ph-sheet-preview-width)">
                  <InvoiceSheet {...sheet} headingLevel={2} />
                </Card>
                <SheetPrint>
                  <InvoiceSheet {...sheet} />
                </SheetPrint>
              </>
            );
          }}
        </QueryState>
      </div>
    </>
  );
}

/** «Счёт» for print: the sheet on screen and an A4 print root (ADR-0015: id in the query). */
export function InvoicePrintPage() {
  return (
    <Suspense
      fallback={
        <div className="grid min-h-dvh place-items-center text-primary">
          <Spinner size="xl" />
        </div>
      }
    >
      <InvoicePrintView />
    </Suspense>
  );
}
