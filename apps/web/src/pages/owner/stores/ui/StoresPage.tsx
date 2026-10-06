'use client';

import type {
  OwnerStore,
  OwnerStoreStatus,
  TenantInvoice,
  TenantService,
  TenantServiceKey,
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
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslations } from 'use-intl';
import { StoreModeBadge } from '@/entities/store';
import { can, canWrite, useSession } from '@/entities/session';
import { apiRequest, useApiErrorMessage } from '@/shared/api';
import { WithMessages } from '@/shared/i18n';
import { QueryState } from '@/shared/ui';
import { PageHeader } from '@/widgets/app-shell';
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

const SERVICE_ORDER: TenantServiceKey[] = [
  'export-1c',
  'fiscal',
  'notifications',
  'print-agent',
  'labels',
];

function ServicesTab() {
  const t = useTranslations('ownerStores.services');
  const { data: session } = useSession();
  const queryClient = useQueryClient();
  const services = useQuery({
    queryKey: ['services'],
    queryFn: ({ signal }) => apiRequest('services.list', { signal }),
  });
  const request = useMutation({
    mutationFn: (key: TenantServiceKey) =>
      apiRequest('services.request', { params: { key } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['services'] }),
  });
  const error = useApiErrorMessage(request.error);
  const canRequest = canWrite(session, 'services:create');

  const stateOf = (service: TenantService) =>
    service.state === 'included' ? (
      <StatusPill tone="success">{t('states.included')}</StatusPill>
    ) : service.state === 'requested' ? (
      <StatusPill tone="info">{t('states.requested')}</StatusPill>
    ) : null;

  return (
    <QueryState query={services}>
      {(data) => (
        <div className="flex flex-col gap-4">
          {error && (
            <Alert tone="danger" live="assertive">
              {error}
            </Alert>
          )}
          <div className="grid grid-cols-3 gap-4">
            {SERVICE_ORDER.map((key) => data.find((s) => s.key === key))
              .filter((s): s is TenantService => s !== undefined)
              .map((service) => (
                <Card key={service.key} className="flex flex-col gap-3">
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="text-md font-bold">
                      {t(`items.${service.key}.title`)}
                    </h3>
                    {stateOf(service)}
                  </div>
                  <p className="flex-1 text-sm text-fg-muted">
                    {t(`items.${service.key}.description`)}
                  </p>
                  {service.state === 'requested' && service.requestedAt && (
                    <p className="text-xs text-fg-subtle">
                      {t('requestedAt', {
                        date: formatDateOnly(service.requestedAt.slice(0, 10)),
                      })}
                    </p>
                  )}
                  {service.state === 'available' && (
                    <Button
                      variant="secondary"
                      className="self-start"
                      disabled={!canRequest}
                      loading={
                        request.isPending && request.variables === service.key
                      }
                      onClick={() => request.mutate(service.key)}
                    >
                      {t('request')}
                    </Button>
                  )}
                </Card>
              ))}
          </div>
          <p className="text-xs text-fg-subtle">{t('scopeHint')}</p>
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
            panel: <ServicesTab />,
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
