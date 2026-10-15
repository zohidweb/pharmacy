'use client';

import type {
  OwnerStore,
  OwnerStoreStatus,
  TenantInvoice,
} from '@pharmacy/shared-dto';
import {
  daysBetween,
  formatDateOnly,
  formatMoney,
  toAppDate,
} from '@pharmacy/shared-util';
import {
  Alert,
  Button,
  Card,
  CardHeader,
  DataTable,
  StatusPill,
  Tabs,
  type DataTableColumn,
  type StatusTone,
} from '@pharmacy/ui';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslations } from 'use-intl';
import { StoreModeBadge } from '@/entities/store';
import { can, canWrite, useSession } from '@/entities/session';
import { apiRequest } from '@/shared/api';
import { WithMessages } from '@/shared/i18n';
import { DemoDataNotice, QueryState } from '@/shared/ui';
import { PageHeader } from '@/widgets/app-shell';
import { ServicesSection } from './ServicesSection';
import { CloseStoreDialog, StoreDialog } from './StoreDialogs';

type Tab = 'stores' | 'services' | 'billing';

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
            {row.status === 'closed' || row.status === 'closing'
              ? t('closedInfo', {
                  date: row.closedOn ? formatDateOnly(row.closedOn) : '—',
                  store: row.stockMovedTo ?? '—',
                })
              : row.address}
          </span>
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
      key: 'paid',
      header: t('columns.paid'),
      nowrap: true,
      cell: (row) =>
        row.licenseValidUntil
          ? t('keyUntil', {
              date: formatDateOnly(row.licenseValidUntil),
              days: daysBetween(today, row.licenseValidUntil),
            })
          : row.paidUntil
            ? t('paidUntil', { date: formatDateOnly(row.paidUntil) })
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
        </div>
      )}
    </QueryState>
  );
}

const invoiceTone = {
  paid: 'success',
  due: 'info',
  overdue: 'danger',
} as const;

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
  const columns: DataTableColumn<TenantInvoice>[] = [
    {
      key: 'period',
      header: t('periodHeader'),
      cell: (row) => period(row.period),
    },
    { key: 'number', header: t('number'), cell: (row) => row.number },
    {
      key: 'amount',
      header: t('amount'),
      numeric: true,
      nowrap: true,
      cell: (row) => formatMoney(row.amountMinor, { withSign: false }),
    },
    {
      key: 'paidOn',
      header: t('paidOn'),
      nowrap: true,
      cell: (row) => (row.paidOn ? formatDateOnly(row.paidOn) : '—'),
    },
    {
      key: 'status',
      header: t('status'),
      cell: (row) => (
        <StatusPill tone={invoiceTone[row.status]}>
          {t(`statuses.${row.status}`)}
        </StatusPill>
      ),
    },
  ];
  return (
    <div className="flex flex-col gap-4">
      <DemoDataNotice routes={['billing.get']} />
      <QueryState query={billing}>
        {(data) => (
          <div className="grid grid-cols-(--ph-return-columns) items-start gap-4">
            <Card padding="none">
              <CardHeader title={t('history')} inset />
              <DataTable
                caption={t('history')}
                rowKey={(row) => row.number}
                rows={data.history}
                columns={columns}
              />
            </Card>
            <Card className="flex flex-col gap-2">
              <span className="text-sm text-fg-muted">{t('current')}</span>
              <b className="text-2xl tabular-nums">
                {formatMoney(data.current.amountMinor)}
              </b>
              <span className="text-sm text-fg-muted">
                {t('formula', {
                  period: period(data.current.period),
                  stores: data.current.activeStores,
                  price: formatMoney(data.current.pricePerStoreMinor),
                })}
              </span>
              <span className="text-sm">
                {t('dueOn', { date: formatDateOnly(data.current.dueOn) })}
              </span>
              <Button
                variant="secondary"
                iconStart="download"
                className="self-start"
                disabled
                aria-describedby="invoice-pdf-pending"
              >
                {t('pdf')}
              </Button>
              <p id="invoice-pdf-pending" className="text-xs text-fg-subtle">
                {t('pdfPending')}
              </p>
            </Card>
          </div>
        )}
      </QueryState>
    </div>
  );
}

/** Stores, services and payment of the network (UI mockup «Кабинет владельца»). */
function StoresPageView() {
  const t = useTranslations('ownerStores');
  const { data: session } = useSession();
  const [tab, setTab] = useState<Tab>('stores');
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
        {session?.impersonation && <Alert tone="info">{t('readOnly')}</Alert>}
        <Tabs
          label={t('title')}
          value={tab}
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
      <StoresPageView />
    </WithMessages>
  );
}
