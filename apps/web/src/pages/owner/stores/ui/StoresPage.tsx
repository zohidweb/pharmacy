'use client';

import type {
  InvoiceLine,
  InvoiceStatus,
  OwnerStore,
  OwnerStoreStatus,
  TenantInvoice,
} from '@pharmacy/shared-dto';
import {
  daysBetween,
  formatDateOnly,
  formatMoney,
  formatPercentBp,
  toAppDate,
} from '@pharmacy/shared-util';
import {
  Button,
  buttonClassName,
  Card,
  CardHeader,
  DataTable,
  Icon,
  StatusPill,
  Tabs,
  type DataTableColumn,
  type StatusTone,
} from '@pharmacy/ui';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { useTranslations } from 'use-intl';
import { StoreModeBadge } from '@/entities/store';
import { can, canWrite, useSession } from '@/entities/session';
import { apiRequest } from '@/shared/api';
import { routes } from '@/shared/config';
import { WithMessages } from '@/shared/i18n';
import { QueryState } from '@/shared/ui';
import { PageHeader } from '@/widgets/app-shell';
import { ServicesSection } from './ServicesSection';
import {
  CancelClosingDialog,
  CloseStoreDialog,
  StoreDialog,
} from './StoreDialogs';

type Tab = 'stores' | 'services' | 'billing';

const TABS: readonly Tab[] = ['stores', 'services', 'billing'];

const statusTone: Record<OwnerStoreStatus, StatusTone> = {
  pending: 'info',
  active: 'success',
  closing: 'warning',
  closed: 'neutral',
};

function StoresTab() {
  const t = useTranslations('ownerStores');
  const { data: session } = useSession();
  const [editing, setEditing] = useState<OwnerStore | 'new' | null>(null);
  const [closing, setClosing] = useState<OwnerStore | null>(null);
  const [cancelling, setCancelling] = useState<OwnerStore | null>(null);
  const overview = useQuery({
    queryKey: ['stores', 'overview'],
    queryFn: ({ signal }) => apiRequest('stores.overview', { signal }),
  });
  const today = toAppDate();

  const columns: DataTableColumn<OwnerStore>[] = [
    {
      key: 'name',
      header: t('columns.store'),
      cell: (row) => (
        <div className="flex flex-col">
          {row.status === 'closed' ? (
            <span className="font-bold text-fg-muted">{row.name}</span>
          ) : (
            <button
              type="button"
              onClick={() => setEditing(row)}
              className="min-h-touch text-start font-bold text-primary underline"
            >
              {row.name}
            </button>
          )}
          <span className="text-xs text-fg-subtle">
            {row.status === 'closed'
              ? row.stockMovedTo === null
                ? t('closedEmptyInfo', {
                    date: row.closedOn ? formatDateOnly(row.closedOn) : '—',
                  })
                : t('closedInfo', {
                    date: row.closedOn ? formatDateOnly(row.closedOn) : '—',
                    store: row.stockMovedTo,
                  })
              : row.status === 'closing'
                ? t('closingInfo', {
                    store: row.stockMovedTo ?? '—',
                    transfers: row.closingTransfers
                      .map(
                        (transfer) =>
                          `${transfer.number} (${t(`closing.transferStatus.${transfer.status}`)})`,
                      )
                      .join(', '),
                  })
                : row.address}
          </span>
          {row.closingCancellable && canWrite(session, 'stores:delete') && (
            <Button
              variant="tertiary"
              size="md"
              iconStart="undo-2"
              className="self-start"
              onClick={() => setCancelling(row)}
            >
              {t('closing.cancel')}
            </Button>
          )}
        </div>
      ),
    },
    {
      key: 'code',
      header: t('columns.code'),
      nowrap: true,
      cell: (row) => row.code,
    },
    {
      key: 'kind',
      header: t('columns.kind'),
      nowrap: true,
      cell: (row) => t(`kinds.${row.kind}`),
    },
    {
      key: 'legalEntity',
      header: t('columns.legalEntity'),
      cell: (row) => row.legalEntityName,
    },
    {
      key: 'mode',
      header: t('columns.mode'),
      cell: (row) =>
        row.status === 'closed' ? '—' : <StoreModeBadge mode={row.mode} />,
    },
    {
      key: 'license',
      header: t('columns.license'),
      nowrap: true,
      cell: (row) =>
        row.licenseValidUntil
          ? t('keyUntil', {
              date: formatDateOnly(row.licenseValidUntil),
              days: daysBetween(today, row.licenseValidUntil),
            })
          : '—',
    },
    {
      key: 'activity',
      header: t('columns.activity'),
      numeric: true,
      nowrap: true,
      cell: (row) => t('receipts', { count: row.receiptsThisMonth }),
    },
    {
      key: 'status',
      header: t('columns.status'),
      cell: (row) => (
        <StatusPill tone={statusTone[row.status]}>
          {t(`statuses.${row.status}`)}
        </StatusPill>
      ),
    },
  ];

  return (
    <QueryState query={overview}>
      {(data) => (
        <div className="flex flex-col gap-4">
          <Card padding="none">
            <CardHeader
              title={t('storesCount', {
                count: data.stores.filter((s) => s.status !== 'closed').length,
              })}
              inset
              actions={
                <Button
                  iconStart="plus"
                  disabled={!canWrite(session, 'stores:create')}
                  onClick={() => setEditing('new')}
                >
                  {t('new')}
                </Button>
              }
            />
            <DataTable
              caption={t('tabs.stores')}
              rowKey={(row) => row.id}
              rows={data.stores}
              columns={columns}
            />
            <p className="px-(--ph-card-padding) py-3 text-xs text-fg-subtle">
              {t('billingRule')}
            </p>
          </Card>
          {editing && (
            <StoreDialog
              key={editing === 'new' ? 'new' : editing.id}
              store={editing === 'new' ? null : editing}
              canEdit={canWrite(
                session,
                editing === 'new' ? 'stores:create' : 'stores:update',
              )}
              canClose={canWrite(session, 'stores:delete')}
              onClose={() => setEditing(null)}
              onCloseStore={(store) => {
                setEditing(null);
                setClosing(store);
              }}
            />
          )}
          {closing && (
            <CloseStoreDialog
              store={closing}
              onClose={() => setClosing(null)}
            />
          )}
          {cancelling && (
            <CancelClosingDialog
              store={cancelling}
              onClose={() => setCancelling(null)}
            />
          )}
        </div>
      )}
    </QueryState>
  );
}

const invoiceTone: Record<InvoiceStatus, StatusTone> = {
  issued: 'info',
  partially_paid: 'warning',
  paid: 'success',
};

type EstimateLine = Omit<InvoiceLine, 'id'>;

/**
 * «Оплата» (spec 2026-10-15-billing-services, 9, A19): the estimate of the current month by the
 * formulas of an invoice, the debt, the overdue debt and the advance, the discounts, the invoices
 * with a print page each.
 */
function BillingTab() {
  const t = useTranslations('ownerStores.billing');
  const billing = useQuery({
    queryKey: ['billing'],
    queryFn: ({ signal }) => apiRequest('billing.get', { signal }),
  });
  const period = (value: string) => {
    const [year, month] = value.split('-');
    return t('period', { month: Number(month), year });
  };
  const lineColumns: DataTableColumn<EstimateLine>[] = [
    {
      key: 'line',
      header: t('line'),
      cell: (line) =>
        line.providedOn === null ? (
          line.description
        ) : (
          <span className="flex flex-col">
            <span>{line.description}</span>
            <span className="text-xs text-fg-subtle">
              {t('providedOn', { date: formatDateOnly(line.providedOn) })}
            </span>
          </span>
        ),
    },
    {
      key: 'days',
      header: t('days'),
      numeric: true,
      nowrap: true,
      cell: (line) =>
        line.days === null
          ? '—'
          : t('daysValue', {
              days: line.days,
              daysInMonth: line.daysInMonth ?? 0,
            }),
    },
    {
      key: 'amount',
      header: t('amount'),
      numeric: true,
      nowrap: true,
      cell: (line) => (
        <span className="flex flex-col items-end">
          <span>{formatMoney(line.amountMinor, { withSign: false })}</span>
          {line.discountBp ? (
            <span className="text-xs text-fg-subtle">
              {t('discountValue', {
                percent: formatPercentBp(line.discountBp),
              })}
            </span>
          ) : null}
        </span>
      ),
    },
  ];
  const invoiceColumns: DataTableColumn<TenantInvoice>[] = [
    {
      key: 'number',
      header: t('columns.number'),
      cell: (row) => (
        <span className="flex flex-col">
          <span className="font-medium whitespace-nowrap">{row.number}</span>
          <span className="text-xs text-fg-subtle">{period(row.period)}</span>
        </span>
      ),
    },
    {
      key: 'total',
      header: t('columns.total'),
      numeric: true,
      nowrap: true,
      cell: (row) => (
        <span className="flex flex-col items-end">
          <span>{formatMoney(row.totalMinor, { withSign: false })}</span>
          <span className="text-xs text-fg-subtle">
            {t('paidValue', {
              amount: formatMoney(row.paidMinor, { withSign: false }),
            })}
          </span>
        </span>
      ),
    },
    {
      key: 'remaining',
      header: t('columns.remaining'),
      numeric: true,
      nowrap: true,
      cell: (row) => (
        <span className="flex flex-col items-end">
          <span>{formatMoney(row.remainingMinor, { withSign: false })}</span>
          <span className="text-xs text-fg-subtle">
            {t('dueValue', { date: formatDateOnly(row.dueOn) })}
          </span>
        </span>
      ),
    },
    {
      key: 'status',
      header: t('columns.status'),
      cell: (row) => (
        <span className="flex flex-col items-start gap-1">
          <span className="inline-flex flex-wrap items-center gap-1">
            <StatusPill tone={invoiceTone[row.status]}>
              {t(`statuses.${row.status}`)}
            </StatusPill>
            {row.overdue && (
              <StatusPill tone="danger">{t('overdue')}</StatusPill>
            )}
          </span>
          {row.paidOn && (
            <span className="text-xs text-fg-subtle">
              {t('paidOnValue', { date: formatDateOnly(row.paidOn) })}
            </span>
          )}
        </span>
      ),
    },
    {
      key: 'print',
      header: <span className="sr-only">{t('print')}</span>,
      cell: (row) => (
        <Link
          href={routes.invoicePrint(row.id)}
          aria-label={t('printInvoice', { number: row.number })}
          title={t('printInvoice', { number: row.number })}
          className={buttonClassName({ variant: 'tertiary' })}
        >
          <Icon name="printer" size="md" />
        </Link>
      ),
    },
  ];
  return (
    <QueryState query={billing}>
      {(data) => {
        const { estimate } = data;
        const balance = [
          ['debt', data.debtMinor],
          ['overdueDebt', data.overdueDebtMinor],
          ['advance', data.advanceMinor],
        ] as const;
        return (
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-(--ph-split-columns) items-start gap-4">
              <Card padding="none">
                <CardHeader
                  title={t('estimate', { period: period(estimate.period) })}
                  description={t('estimateNote', {
                    date: formatDateOnly(estimate.through),
                    price: formatMoney(estimate.pricePerStoreMinor),
                  })}
                  inset
                />
                {estimate.lines.length === 0 ? (
                  <p className="m-0 px-(--ph-card-padding) text-sm text-fg-muted">
                    {t('noActivity')}
                  </p>
                ) : (
                  <DataTable
                    caption={t('lines')}
                    minWidth="none"
                    rowKey={(line) =>
                      `${line.kind}-${line.storeId ?? line.tenantServiceId}`
                    }
                    rows={estimate.lines}
                    columns={lineColumns}
                  />
                )}
                <dl className="m-0 flex flex-col gap-1 px-(--ph-card-padding) py-4 text-sm">
                  {(
                    [
                      ['net', estimate.netMinor],
                      ['vat', estimate.vatMinor],
                      ['total', estimate.totalMinor],
                    ] as const
                  ).map(([key, value]) => (
                    <div key={key} className="flex justify-between gap-4">
                      <dt
                        className={
                          key === 'total' ? 'font-bold' : 'text-fg-muted'
                        }
                      >
                        {t(key, { rate: estimate.vatRatePercent })}
                      </dt>
                      <dd
                        className={
                          key === 'total'
                            ? 'm-0 text-lg font-bold tabular-nums'
                            : 'm-0 tabular-nums'
                        }
                      >
                        {formatMoney(value)}
                      </dd>
                    </div>
                  ))}
                </dl>
              </Card>
              <div className="flex flex-col gap-4">
                <Card as="section" aria-labelledby="billing-balance">
                  <CardHeader titleId="billing-balance" title={t('balance')} />
                  <dl className="m-0 flex flex-col gap-3">
                    {balance.map(([key, value]) => (
                      <div key={key} className="flex flex-col gap-1">
                        <dt className="text-sm text-fg-muted">{t(key)}</dt>
                        <dd
                          className={
                            key === 'overdueDebt' && value > 0
                              ? 'm-0 text-xl font-bold text-danger tabular-nums'
                              : 'm-0 text-xl font-bold tabular-nums'
                          }
                        >
                          {formatMoney(value)}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </Card>
                <Card as="section" aria-labelledby="billing-discounts">
                  <CardHeader
                    titleId="billing-discounts"
                    title={t('discounts')}
                  />
                  {data.discounts.length === 0 ? (
                    <p className="m-0 text-sm text-fg-muted">
                      {t('noDiscounts')}
                    </p>
                  ) : (
                    <ul className="m-0 flex list-none flex-col gap-1 p-0 text-sm">
                      {data.discounts.map((discount) => (
                        <li key={`${discount.fromMonth}-${discount.toMonth}`}>
                          {t('discountItem', {
                            percent: formatPercentBp(discount.percentBp),
                            from: period(discount.fromMonth),
                            to: period(discount.toMonth),
                          })}
                        </li>
                      ))}
                    </ul>
                  )}
                </Card>
              </div>
            </div>
            <Card padding="none">
              <CardHeader title={t('history')} inset />
              <DataTable
                caption={t('history')}
                rowKey={(row) => row.id}
                rows={data.invoices}
                columns={invoiceColumns}
                empty={t('noInvoices')}
              />
            </Card>
          </div>
        );
      }}
    </QueryState>
  );
}

/**
 * Stores, services and payment of the network (UI mockup «Кабинет владельца»); `?tab=billing` opens
 * «Оплата» (the way back from an invoice print page).
 */
function StoresPageView() {
  const t = useTranslations('ownerStores');
  const { data: session } = useSession();
  const requested = useSearchParams()?.get('tab');
  const [tab, setTab] = useState<Tab>(
    TABS.find((value) => value === requested) ?? 'stores',
  );
  const items = [
    { value: 'stores' as const, label: t('tabs.stores'), panel: <StoresTab /> },
    ...(can(session, 'services:view')
      ? [
          {
            value: 'services' as const,
            label: t('tabs.services'),
            panel: <ServicesSection />,
          },
        ]
      : []),
    ...(can(session, 'billing:view')
      ? [
          {
            value: 'billing' as const,
            label: t('tabs.billing'),
            panel: <BillingTab />,
          },
        ]
      : []),
  ];
  return (
    <>
      <PageHeader title={t('title')} />
      <div className="flex flex-col gap-4 px-6 pt-4">
        <Tabs
          label={t('title')}
          value={items.some((item) => item.value === tab) ? tab : 'stores'}
          onValueChange={setTab}
          items={items}
        />
      </div>
    </>
  );
}

export function StoresPage() {
  return (
    <WithMessages groups={['owner']}>
      <Suspense>
        <StoresPageView />
      </Suspense>
    </WithMessages>
  );
}
