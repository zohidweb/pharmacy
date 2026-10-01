'use client';

import type {
  AuditEntry,
  StoreSummary,
  TenantInvoiceItem,
  TenantServiceItem,
} from '@pharmacy/shared-dto';
import {
  formatDateOnly,
  formatDateTime,
  formatMoney,
} from '@pharmacy/shared-util';
import {
  BarChart,
  Card,
  CardHeader,
  DataTable,
  EmptyState,
  KpiTile,
  Pagination,
  StatusPill,
  type DataTableColumn,
} from '@pharmacy/ui';
import Link from 'next/link';
import { useState } from 'react';
import { useFormatter, useTranslations } from 'use-intl';
import { StoreModePill, StoreStatusPill } from '@/entities/store';
import {
  useTenantAudit,
  useTenantInvoices,
  useTenantPayments,
  useTenantServices,
  useTenantStats,
  useTenantStores,
} from '@/entities/tenant';
import { routes } from '@/shared/config';
import { QueryState } from '@/shared/ui';

export function StoresTab({ tenantId }: { tenantId: string }) {
  const t = useTranslations('company.stores');
  const format = useFormatter();
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
      cell: (store) => {
        const date =
          store.mode === 'cloud' ? store.paidUntil : store.licenseValidUntil;
        return date
          ? t(store.mode === 'cloud' ? 'paidUntil' : 'keyUntil', {
              date: formatDateOnly(date),
            })
          : '—';
      },
    },
    {
      key: 'sync',
      header: t('columns.sync'),
      nowrap: true,
      cell: (store) =>
        store.mode === 'cloud'
          ? t('online')
          : store.lastSyncAt
            ? format.relativeTime(new Date(store.lastSyncAt), new Date())
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

const invoiceTone = {
  issued: 'info',
  paid: 'success',
  overdue: 'danger',
} as const;

export function BillingTab({ tenantId }: { tenantId: string }) {
  const t = useTranslations('company.billing');
  const invoices = useTenantInvoices(tenantId);
  const payments = useTenantPayments(tenantId);
  const columns: DataTableColumn<TenantInvoiceItem>[] = [
    {
      key: 'number',
      header: t('columns.number'),
      nowrap: true,
      cell: (invoice) => <span className="font-mono">{invoice.number}</span>,
    },
    {
      key: 'period',
      header: t('columns.period'),
      nowrap: true,
      cell: (invoice) => formatDateOnly(`${invoice.period}-01`).slice(3),
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
      key: 'status',
      header: t('columns.status'),
      nowrap: true,
      cell: (invoice) => (
        <StatusPill tone={invoiceTone[invoice.status]}>
          {t(`status.${invoice.status}`)}
        </StatusPill>
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
                    <span className="font-bold tabular-nums">
                      {formatMoney(payment.amountMinor)}
                    </span>
                    <span className="text-xs text-fg-subtle">
                      {formatDateOnly(payment.paidOn)} ·{' '}
                      {t(`method.${payment.method}`)} · {payment.recordedBy}
                    </span>
                  </li>
                ))}
              </ul>
            )
          }
        </QueryState>
      </Card>
    </div>
  );
}

export function ServicesTab({ tenantId }: { tenantId: string }) {
  const t = useTranslations('company.services');
  const columns: DataTableColumn<TenantServiceItem>[] = [
    {
      key: 'name',
      header: t('columns.service'),
      cell: (service) => service.name,
    },
    {
      key: 'billing',
      header: t('columns.billing'),
      nowrap: true,
      cell: (service) => t(`billing.${service.billing}`),
    },
    {
      key: 'connected',
      header: t('columns.connected'),
      nowrap: true,
      cell: (service) => formatDateOnly(service.connectedOn),
    },
    {
      key: 'status',
      header: t('columns.status'),
      nowrap: true,
      cell: (service) => (
        <StatusPill tone={service.status === 'active' ? 'success' : 'warning'}>
          {t(`status.${service.status}`)}
        </StatusPill>
      ),
    },
    {
      key: 'price',
      header: t('columns.price'),
      numeric: true,
      nowrap: true,
      cell: (service) =>
        service.billing === 'monthly'
          ? t('perMonth', { price: formatMoney(service.priceMinor) })
          : formatMoney(service.priceMinor),
    },
  ];
  return (
    <QueryState query={useTenantServices(tenantId)}>
      {(rows) => (
        <Card padding="none">
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

const AUDIT_PAGE = 20;

export function AuditTab({ tenantId }: { tenantId: string }) {
  const t = useTranslations('company.audit');
  const tTable = useTranslations('table');
  const [offset, setOffset] = useState(0);
  const columns: DataTableColumn<AuditEntry>[] = [
    {
      key: 'at',
      header: t('columns.at'),
      nowrap: true,
      cell: (entry) => formatDateTime(entry.at),
    },
    {
      key: 'actor',
      header: t('columns.actor'),
      cell: (entry) => (
        <div className="flex flex-col items-start gap-1">
          <span>{entry.actorName}</span>
          {entry.actorIsPlatformOperator && (
            <StatusPill tone="attention">{t('operatorTag')}</StatusPill>
          )}
        </div>
      ),
    },
    {
      key: 'store',
      header: t('columns.store'),
      cell: (entry) => entry.storeName ?? '—',
    },
    {
      key: 'action',
      header: t('columns.action'),
      cell: (entry) => entry.action,
    },
  ];
  return (
    <QueryState query={useTenantAudit(tenantId, { limit: AUDIT_PAGE, offset })}>
      {(page) => (
        <Card padding="none">
          <CardHeader title={t('title')} description={t('retention')} inset />
          <DataTable
            caption={t('title')}
            columns={columns}
            rows={page.items}
            rowKey={(entry) => entry.id}
            empty={<EmptyState icon="scroll-text" title={t('empty')} />}
          />
          {page.total > AUDIT_PAGE && (
            <Pagination
              className="p-4"
              offset={offset}
              limit={AUDIT_PAGE}
              total={page.total}
              onOffsetChange={setOffset}
              labels={{
                nav: t('pagesLabel'),
                previous: tTable('previous'),
                next: tTable('next'),
                range: (range) => tTable('range', range),
              }}
            />
          )}
        </Card>
      )}
    </QueryState>
  );
}
