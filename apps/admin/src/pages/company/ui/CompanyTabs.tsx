'use client';

import type {
  StoreSummary,
  TenantInvoiceItem,
  TenantServiceItem,
} from '@pharmacy/shared-dto';
import {
  formatDateOnly,
  formatDateTime,
  formatMoney,
  formatPeriod,
} from '@pharmacy/shared-util';
import {
  BarChart,
  Card,
  CardHeader,
  DataTable,
  EmptyState,
  KpiTile,
  type DataTableColumn,
} from '@pharmacy/ui';
import Link from 'next/link';
import { useTranslations } from 'use-intl';
import { InvoiceStatusPill } from '@/entities/invoice';
import { StoreModePill, StoreStatusPill } from '@/entities/store';
import {
  useTenantInvoices,
  useTenantPayments,
  useTenantServices,
  useTenantStats,
  useTenantStores,
} from '@/entities/tenant';
import { TenantDiscounts } from '@/features/tenant-discounts';
import {
  AddTenantService,
  TenantServiceActions,
  TenantServiceStatusPill,
} from '@/features/tenant-service-actions';
import { routes } from '@/shared/config';
import { useTimeAgo } from '@/shared/i18n';
import { AsOfNote, QueryState } from '@/shared/ui';

export function StoresTab({ tenantId }: { tenantId: string }) {
  const t = useTranslations('company.stores');
  const timeAgo = useTimeAgo();
  const columns: DataTableColumn<StoreSummary>[] = [
    {
      key: 'name',
      header: t('columns.store'),
      cell: (store) => (
        <div className="flex flex-col">
          <Link
            href={routes.store(store.id)}
            className="font-medium text-fg hover:text-primary"
          >
            {store.name}
          </Link>
          <span className="text-xs text-fg-subtle">{store.address}</span>
        </div>
      ),
    },
    {
      key: 'mode',
      header: t('columns.mode'),
      nowrap: true,
      cell: (store) => <StoreModePill mode={store.mode} />,
    },
    {
      key: 'status',
      header: t('columns.status'),
      nowrap: true,
      cell: (store) => <StoreStatusPill store={store} />,
    },
    {
      key: 'term',
      header: t('columns.term'),
      nowrap: true,
      // a cloud store is billed by the invoices of the company (spec 2026-10-15-billing-services, B12)
      cell: (store) =>
        store.mode === 'offline' && store.licenseValidUntil
          ? t('keyUntil', { date: formatDateOnly(store.licenseValidUntil) })
          : '—',
    },
    {
      key: 'sync',
      header: t('columns.sync'),
      nowrap: true,
      cell: (store) =>
        store.mode === 'cloud'
          ? t('online')
          : store.lastSyncAt
            ? timeAgo(new Date(store.lastSyncAt))
            : t('never'),
    },
    {
      key: 'sales',
      header: t('columns.sales'),
      numeric: true,
      nowrap: true,
      cell: (store) => formatMoney(store.monthSalesMinor, { withSign: false }),
    },
  ];

  return (
    <QueryState query={useTenantStores(tenantId)}>
      {(stores) => (
        <Card padding="none">
          <DataTable
            caption={t('caption')}
            columns={columns}
            rows={stores}
            rowKey={(store) => store.id}
          />
          <p className="px-(--ph-table-cell-padding-x) py-3 text-xs text-fg-subtle">
            {t('footnote')}
          </p>
        </Card>
      )}
    </QueryState>
  );
}

export function BillingTab({ tenantId }: { tenantId: string }) {
  const t = useTranslations('company.billing');
  const invoices = useTenantInvoices(tenantId);
  const payments = useTenantPayments(tenantId);
  const columns: DataTableColumn<TenantInvoiceItem>[] = [
    {
      key: 'number',
      header: t('columns.number'),
      nowrap: true,
      // the invoice opens as its print page (spec 2026-10-26-pilot-small-gaps, P10)
      cell: (invoice) => (
        <Link
          href={routes.invoicePrint(invoice.id)}
          className="font-mono text-primary hover:text-primary-hover"
        >
          {invoice.number}
        </Link>
      ),
    },
    {
      key: 'period',
      header: t('columns.period'),
      nowrap: true,
      cell: (invoice) => formatPeriod(invoice.period),
    },
    {
      key: 'stores',
      header: t('columns.stores'),
      cell: (invoice) =>
        invoice.hasServices
          ? t('storesWithServices', { count: invoice.stores })
          : invoice.stores,
    },
    {
      key: 'total',
      header: t('columns.total'),
      numeric: true,
      nowrap: true,
      cell: (invoice) => formatMoney(invoice.totalMinor, { withSign: false }),
    },
    {
      key: 'paid',
      header: t('columns.paid'),
      numeric: true,
      nowrap: true,
      cell: (invoice) => formatMoney(invoice.paidMinor, { withSign: false }),
    },
    {
      key: 'remaining',
      header: t('columns.remaining'),
      numeric: true,
      nowrap: true,
      cell: (invoice) =>
        formatMoney(invoice.remainingMinor, { withSign: false }),
    },
    {
      key: 'status',
      header: t('columns.status'),
      nowrap: true,
      cell: (invoice) => (
        <InvoiceStatusPill status={invoice.status} overdue={invoice.overdue} />
      ),
    },
  ];

  return (
    <div className="grid grid-cols-3 gap-4">
      <Card padding="none" className="col-span-2">
        <CardHeader title={t('invoices')} inset />
        <QueryState query={invoices}>
          {(rows) => (
            <DataTable
              caption={t('invoices')}
              columns={columns}
              rows={rows}
              rowKey={(invoice) => invoice.id}
              empty={<EmptyState icon="receipt" title={t('noInvoices')} />}
              minWidth="none"
            />
          )}
        </QueryState>
      </Card>
      <Card as="section" aria-labelledby="payments-title">
        <CardHeader title={t('payments')} titleId="payments-title" />
        <QueryState query={payments}>
          {(rows) =>
            rows.length === 0 ? (
              <EmptyState icon="receipt" title={t('noPayments')} />
            ) : (
              <ul className="m-0 flex list-none flex-col gap-3 p-0">
                {rows.map((payment) => (
                  <li
                    key={payment.id}
                    className="flex flex-col border-b border-border pb-3 last:border-b-0"
                  >
                    <span
                      className={
                        payment.cancelled
                          ? 'font-bold tabular-nums text-fg-subtle line-through'
                          : 'font-bold tabular-nums'
                      }
                    >
                      {formatMoney(payment.amountMinor)}
                    </span>
                    <span className="text-xs text-fg-subtle">
                      {[
                        formatDateOnly(payment.paidOn),
                        t(`method.${payment.method}`),
                        payment.recordedBy,
                        payment.invoiceNumber &&
                          t('toInvoice', { number: payment.invoiceNumber }),
                        payment.cancelled && t('cancelled'),
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  </li>
                ))}
              </ul>
            )
          }
        </QueryState>
      </Card>
      <div className="col-span-3">
        <TenantDiscounts tenantId={tenantId} />
      </div>
    </div>
  );
}

/** The services of the network: decisions on its requests and services added by the operator. */
export function ServicesTab({
  tenantId,
  tenantName,
}: {
  tenantId: string;
  tenantName: string;
}) {
  const t = useTranslations('company.services');
  const columns: DataTableColumn<TenantServiceItem>[] = [
    {
      key: 'name',
      header: t('columns.service'),
      cell: (service) => (
        <span className="flex flex-col">
          <span>{service.serviceName}</span>
          {service.comment && (
            <span className="text-xs text-fg-subtle">«{service.comment}»</span>
          )}
          {service.reason && (
            <span className="text-xs text-fg-subtle">
              {t('reason', { reason: service.reason })}
            </span>
          )}
        </span>
      ),
    },
    {
      key: 'status',
      header: t('columns.status'),
      nowrap: true,
      cell: (service) => <TenantServiceStatusPill status={service.status} />,
    },
    {
      key: 'decided',
      header: t('columns.decided'),
      nowrap: true,
      cell: (service) => formatDateTime(service.decidedAt),
    },
    {
      key: 'provided',
      header: t('columns.provided'),
      nowrap: true,
      cell: (service) =>
        service.providedOn ? formatDateOnly(service.providedOn) : '—',
    },
    {
      key: 'price',
      header: t('columns.price'),
      numeric: true,
      nowrap: true,
      cell: (service) =>
        service.priceMinor === null ? '—' : formatMoney(service.priceMinor),
    },
    {
      key: 'actions',
      header: t('columns.actions'),
      cell: (service) => <TenantServiceActions service={service} />,
    },
  ];
  return (
    <QueryState query={useTenantServices(tenantId)}>
      {(rows) => (
        <Card padding="none">
          <CardHeader
            inset
            title={t('title')}
            actions={
              <AddTenantService tenantId={tenantId} tenantName={tenantName} />
            }
          />
          <DataTable
            caption={t('caption')}
            columns={columns}
            rows={rows}
            rowKey={(service) => service.id}
            empty={<EmptyState icon="sparkles" title={t('empty')} />}
            minWidth="none"
          />
        </Card>
      )}
    </QueryState>
  );
}

export function StatsTab({ tenantId }: { tenantId: string }) {
  const t = useTranslations('company.stats');
  return (
    <QueryState query={useTenantStats(tenantId)}>
      {(stats) => (
        <div className="flex flex-col gap-4">
          <AsOfNote at={stats.asOf} />
          <div className="grid grid-cols-4 gap-4">
            <KpiTile
              label={t('receipts')}
              value={stats.receipts.toLocaleString('ru-RU')}
            />
            <KpiTile label={t('sales')} value={formatMoney(stats.salesMinor)} />
            <KpiTile
              label={t('averageReceipt')}
              value={formatMoney(stats.averageReceiptMinor)}
            />
            <KpiTile label={t('activeCashiers')} value={stats.activeCashiers} />
          </div>
          <Card as="section" aria-labelledby="sales-chart-title">
            <CardHeader title={t('chartTitle')} titleId="sales-chart-title" />
            <BarChart
              caption={t('chartTitle')}
              columnLabels={{ label: t('day'), value: t('sales') }}
              items={stats.daily.map((day) => ({
                key: day.date,
                label: formatDateOnly(day.date).slice(0, 5),
                value: day.salesMinor,
                valueText: formatMoney(day.salesMinor),
              }))}
            />
          </Card>
        </div>
      )}
    </QueryState>
  );
}
