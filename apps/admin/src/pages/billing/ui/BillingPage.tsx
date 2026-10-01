'use client';

import type {
  InvoiceListFilter,
  InvoiceListItem,
  PaymentListItem,
} from '@pharmacy/shared-dto';
import { formatDateOnly, formatMoney, toAppDate } from '@pharmacy/shared-util';
import {
  Button,
  Card,
  CardHeader,
  Chip,
  ChipGroup,
  DataTable,
  EmptyState,
  KpiTile,
  Pagination,
  StatusPill,
  type DataTableColumn,
} from '@pharmacy/ui';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { useTranslations } from 'use-intl';
import {
  billingKeys,
  InvoiceStatusPill,
  useInvoices,
} from '@/entities/invoice';
import { RecordPayment } from '@/features/record-payment';
import { apiRequest } from '@/shared/api';
import { routes } from '@/shared/config';
import { QueryState } from '@/shared/ui';
import { PageHeader } from '@/widgets/app-shell';
import {
  formatPeriod,
  GenerateInvoices,
  InvoiceDetailsDialog,
  PaymentDialog,
  RecalculateDialog,
} from './InvoiceDialogs';

const INVOICE_PAGE = 5;
const PAYMENT_PAGE = 10;
const filters: InvoiceListFilter[] = ['all', 'paid', 'overdue'];

function previousPeriod(): string {
  const [year, month] = toAppDate().split('-').map(Number);
  return new Date(Date.UTC(year, month - 2, 1)).toISOString().slice(0, 7);
}

/** «Счета и платежи» (UI mockup «Биллинг»): invoices of all tenants and recorded payments. */
export function BillingPage() {
  const t = useTranslations('billing');
  const tTable = useTranslations('table');
  const period = previousPeriod();
  const [filter, setFilter] = useState<InvoiceListFilter>('all');
  const [invoiceOffset, setInvoiceOffset] = useState(0);
  const [paymentOffset, setPaymentOffset] = useState(0);
  const [opened, setOpened] = useState<InvoiceListItem | null>(null);
  const [recalculating, setRecalculating] = useState<InvoiceListItem | null>(
    null,
  );
  const [payment, setPayment] = useState<PaymentListItem | null>(null);

  const summary = useQuery({
    queryKey: billingKeys.summary(period),
    queryFn: ({ signal }) =>
      apiRequest('billing.summary', { query: { period }, signal }),
  });
  const invoices = useInvoices({
    filter,
    limit: INVOICE_PAGE,
    offset: invoiceOffset,
  });
  const payments = useQuery({
    queryKey: billingKeys.payments({
      limit: PAYMENT_PAGE,
      offset: paymentOffset,
    }),
    queryFn: ({ signal }) =>
      apiRequest('payments.list', {
        query: { limit: PAYMENT_PAGE, offset: paymentOffset },
        signal,
      }),
    placeholderData: keepPreviousData,
  });

  const pagination = (key: 'invoicesPages' | 'paymentsPages') => ({
    nav: t(key),
    previous: tTable('previous'),
    next: tTable('next'),
    range: (range: { from: number; to: number; total: number }) =>
      tTable('range', range),
  });

  const invoiceColumns: DataTableColumn<InvoiceListItem>[] = [
    {
      key: 'number',
      header: t('columns.number'),
      nowrap: true,
      cell: (row) => <span className="font-mono">{row.number}</span>,
    },
    {
      key: 'tenant',
      header: t('columns.tenant'),
      cell: (row) => (
        <Link
          href={routes.company(row.tenantId)}
          className="text-fg hover:text-primary"
        >
          {row.tenantName}
        </Link>
      ),
    },
    {
      key: 'period',
      header: t('columns.period'),
      nowrap: true,
      cell: (row) => formatPeriod(row.period),
    },
    {
      key: 'stores',
      header: t('columns.stores'),
      nowrap: true,
      cell: (row) =>
        row.hasServices
          ? t('storesWithServices', { count: row.stores })
          : row.stores,
    },
    {
      key: 'net',
      header: t('columns.net'),
      numeric: true,
      nowrap: true,
      cell: (row) => formatMoney(row.netMinor, { withSign: false }),
    },
    {
      key: 'vat',
      header: t('columns.vat'),
      numeric: true,
      nowrap: true,
      cell: (row) => formatMoney(row.vatMinor, { withSign: false }),
    },
    {
      key: 'total',
      header: t('columns.total'),
      numeric: true,
      nowrap: true,
      cell: (row) => (
        <span className="font-bold">
          {formatMoney(row.totalMinor, { withSign: false })}
        </span>
      ),
    },
    {
      key: 'status',
      header: t('columns.status'),
      nowrap: true,
      cell: (row) => <InvoiceStatusPill status={row.status} />,
    },
    {
      key: 'actions',
      header: <span className="ph-visually-hidden">{tTable('actions')}</span>,
      align: 'end',
      nowrap: true,
      cell: (row) => (
        <div className="flex justify-end gap-1">
          <Button
            variant="tertiary"
            onClick={() => setOpened(row)}
            aria-label={t('openInvoice', { number: row.number })}
          >
            {t('open')}
          </Button>
          {row.status !== 'paid' && (
            <Button
              variant="tertiary"
              onClick={() => setRecalculating(row)}
              aria-label={t('recalculateInvoice', { number: row.number })}
            >
              {t('recalculateAction')}
            </Button>
          )}
        </div>
      ),
    },
  ];

  const paymentColumns: DataTableColumn<PaymentListItem>[] = [
    {
      key: 'date',
      header: t('payments.columns.date'),
      nowrap: true,
      cell: (row) => formatDateOnly(row.paidOn),
    },
    {
      key: 'tenant',
      header: t('payments.columns.tenant'),
      cell: (row) => row.tenantName,
    },
    {
      key: 'invoice',
      header: t('payments.columns.invoice'),
      nowrap: true,
      cell: (row) => <span className="font-mono">{row.invoiceNumber}</span>,
    },
    {
      key: 'amount',
      header: t('payments.columns.amount'),
      numeric: true,
      nowrap: true,
      cell: (row) => (
        <span
          className={row.cancelled ? 'text-fg-subtle line-through' : undefined}
        >
          {formatMoney(row.amountMinor, { withSign: false })}
        </span>
      ),
    },
    {
      key: 'method',
      header: t('payments.columns.method'),
      nowrap: true,
      cell: (row) => t(`payments.method.${row.method}`),
    },
    {
      key: 'recordedBy',
      header: t('payments.columns.recordedBy'),
      cell: (row) => row.recordedBy,
    },
    {
      key: 'state',
      header: t('payments.columns.state'),
      nowrap: true,
      cell: (row) =>
        row.cancelled ? (
          <StatusPill tone="neutral" icon="ban">
            {t('payments.cancelled')}
          </StatusPill>
        ) : (
          <StatusPill tone="success">{t('payments.active')}</StatusPill>
        ),
    },
    {
      key: 'actions',
      header: <span className="ph-visually-hidden">{tTable('actions')}</span>,
      align: 'end',
      cell: (row) => (
        <Button
          variant="tertiary"
          onClick={() => setPayment(row)}
          aria-label={t('payments.openFor', { number: row.invoiceNumber })}
        >
          {t('open')}
        </Button>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title={t('title')}
        subtitle={t('subtitle', { period: formatPeriod(period) })}
      />
      <div className="flex flex-col gap-4 p-6">
        <QueryState query={summary}>
          {(data) => (
            <div className="grid grid-cols-4 gap-4">
              <KpiTile
                label={t('kpi.issued')}
                value={formatMoney(data.issuedMinor)}
                hint={t('kpi.issuedHint', { rate: data.vatRatePercent })}
                icon="file-text"
              />
              <KpiTile
                label={t('kpi.paid')}
                value={formatMoney(data.paidMinor)}
                hint={t('kpi.paidHint', {
                  paid: data.paidInvoices,
                  total: data.invoices,
                })}
                tone="success"
                icon="circle-check"
              />
              <KpiTile
                label={t('kpi.overdue')}
                value={formatMoney(data.overdueMinor)}
                hint={t('kpi.overdueHint', { count: data.overdueTenants })}
                tone={data.overdueMinor > 0 ? 'danger' : 'default'}
                icon="triangle-alert"
              />
              <KpiTile
                label={t('kpi.price')}
                value={formatMoney(data.pricePerStoreMinor)}
                hint={t('kpi.priceHint')}
                icon="store"
              />
            </div>
          )}
        </QueryState>

        <Card padding="none">
          <CardHeader
            title={t('invoices')}
            inset
            actions={
              <>
                <GenerateInvoices />
                <RecordPayment />
              </>
            }
          />
          <div className="px-(--ph-card-padding) pb-4">
            <ChipGroup label={t('filterLabel')}>
              {filters.map((value) => (
                <Chip
                  key={value}
                  selected={filter === value}
                  count={invoices.data?.counts[value]}
                  onClick={() => {
                    setFilter(value);
                    setInvoiceOffset(0);
                  }}
                >
                  {t(`filters.${value}`)}
                </Chip>
              ))}
            </ChipGroup>
          </div>
          <QueryState query={invoices}>
            {(data) => (
              <>
                <DataTable
                  caption={t('invoices')}
                  columns={invoiceColumns}
                  rows={data.items}
                  rowKey={(row) => row.id}
                  empty={<EmptyState icon="receipt" title={t('noInvoices')} />}
                  minWidth="lg"
                />
                {data.total > INVOICE_PAGE && (
                  <Pagination
                    className="p-4"
                    offset={invoiceOffset}
                    limit={INVOICE_PAGE}
                    total={data.total}
                    onOffsetChange={setInvoiceOffset}
                    labels={pagination('invoicesPages')}
                  />
                )}
              </>
            )}
          </QueryState>
          <p className="border-t border-border px-(--ph-table-cell-padding-x) py-3 text-xs text-fg-subtle">
            {t('prorationNote')}
          </p>
        </Card>

        <Card padding="none">
          <CardHeader title={t('payments.title')} inset />
          <QueryState query={payments}>
            {(data) => (
              <>
                <DataTable
                  caption={t('payments.title')}
                  columns={paymentColumns}
                  rows={data.items}
                  rowKey={(row) => row.id}
                  empty={
                    <EmptyState icon="receipt" title={t('payments.empty')} />
                  }
                  minWidth="lg"
                />
                {data.total > PAYMENT_PAGE && (
                  <Pagination
                    className="p-4"
                    offset={paymentOffset}
                    limit={PAYMENT_PAGE}
                    total={data.total}
                    onOffsetChange={setPaymentOffset}
                    labels={pagination('paymentsPages')}
                  />
                )}
              </>
            )}
          </QueryState>
          <p className="border-t border-border px-(--ph-table-cell-padding-x) py-3 text-xs text-fg-subtle">
            {t('payments.note')}
          </p>
        </Card>
      </div>
      <InvoiceDetailsDialog invoice={opened} onClose={() => setOpened(null)} />
      <RecalculateDialog
        invoice={recalculating}
        onClose={() => setRecalculating(null)}
      />
      <PaymentDialog payment={payment} onClose={() => setPayment(null)} />
    </>
  );
}
