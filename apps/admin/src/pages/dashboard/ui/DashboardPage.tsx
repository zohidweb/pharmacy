'use client';

import { formatDateOnly, formatMoney, toAppDate } from '@pharmacy/shared-util';
import {
  BarChart,
  Card,
  CardHeader,
  EmptyState,
  Icon,
  KpiTile,
  type StatusTone,
} from '@pharmacy/ui';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useFormatter, useTranslations } from 'use-intl';
import {
  eventHref,
  eventIcon,
  eventTone,
  useEventText,
} from '@/entities/event';
import { TenantStatusPill, useTenantList } from '@/entities/tenant';
import { apiRequest } from '@/shared/api';
import { routes } from '@/shared/config';
import { QueryState } from '@/shared/ui';
import { PageHeader } from '@/widgets/app-shell';

const toneSurface: Record<StatusTone, string> = {
  success: 'bg-success-subtle text-success',
  warning: 'bg-warning-subtle text-warning',
  danger: 'bg-danger-subtle text-danger',
  info: 'bg-info-subtle text-info',
  attention: 'bg-attention-subtle text-attention',
  neutral: 'bg-surface-sunken text-fg-muted',
};

/** Platform overview (UI mockup «Дашборд»). */
export function DashboardPage() {
  const t = useTranslations('dashboard');
  const format = useFormatter();
  const text = useEventText();
  const dashboard = useQuery({
    queryKey: ['dashboard'],
    queryFn: ({ signal }) => apiRequest('dashboard.get', { signal }),
  });
  const tenants = useTenantList({
    sort: 'monthlyCharge',
    direction: 'desc',
    limit: 5,
  });
  const month = format.dateTime(
    new Date(`${toAppDate().slice(0, 7)}-15T00:00:00Z`),
    {
      month: 'long',
      year: 'numeric',
    },
  );

  return (
    <>
      <PageHeader title={t('title')} subtitle={t('subtitle', { month })} />
      <div className="flex flex-col gap-4 p-6">
        <QueryState query={dashboard}>
          {({ summary, sales, queue }) => {
            const attention =
              summary.attention.overdueInvoices +
              summary.attention.expiringKeys +
              summary.attention.serviceRequests +
              summary.attention.staleSync;
            return (
              <>
                <div className="grid grid-cols-4 gap-4">
                  <KpiTile
                    label={t('kpi.tenants')}
                    value={summary.tenants}
                    hint={t('kpi.tenantsHint', {
                      active: summary.activeTenants,
                    })}
                    icon="building-2"
                  />
                  <KpiTile
                    label={t('kpi.stores')}
                    value={summary.cloudStores + summary.offlineStores}
                    hint={t('kpi.storesHint', {
                      cloud: summary.cloudStores,
                      offline: summary.offlineStores,
                    })}
                    icon="store"
                  />
                  <KpiTile
                    label={t('kpi.accrued')}
                    value={formatMoney(summary.accruedMinor)}
                    hint={t('kpi.accruedHint')}
                    icon="receipt"
                  />
                  <KpiTile
                    label={t('kpi.attention')}
                    value={attention}
                    hint={t('kpi.attentionHint', summary.attention)}
                    tone={attention > 0 ? 'warning' : 'success'}
                    icon="triangle-alert"
                  />
                </div>
                <div className="grid grid-cols-3 items-start gap-4">
                  <Card
                    as="section"
                    aria-labelledby="sales-title"
                    className="col-span-2"
                  >
                    <CardHeader
                      title={t('salesTitle')}
                      titleId="sales-title"
                      description={t('salesHint')}
                    />
                    <BarChart
                      caption={t('salesTitle')}
                      columnLabels={{ label: t('day'), value: t('sales') }}
                      items={sales.map((day) => ({
                        key: day.date,
                        label: formatDateOnly(day.date).slice(0, 5),
                        value: day.salesMinor,
                        valueText: formatMoney(day.salesMinor),
                      }))}
                    />
                  </Card>
                  <Card
                    as="section"
                    padding="none"
                    aria-labelledby="queue-title"
                  >
                    <CardHeader
                      title={t('queueTitle')}
                      titleId="queue-title"
                      inset
                    />
                    {queue.length === 0 ? (
                      <EmptyState icon="circle-check" title={t('queueEmpty')} />
                    ) : (
                      <ul className="m-0 flex list-none flex-col p-0">
                        {queue.map((item) => {
                          const { title, detail } = text(
                            item.kind,
                            item.params,
                          );
                          return (
                            <li
                              key={item.id}
                              className="border-t border-border"
                            >
                              <Link
                                href={eventHref(item.target)}
                                className="flex items-start gap-3 px-(--ph-card-padding) py-3 hover:bg-surface-sunken"
                              >
                                <span
                                  className={`grid size-8 shrink-0 place-items-center rounded-md ${toneSurface[eventTone[item.kind]]}`}
                                >
                                  <Icon name={eventIcon[item.kind]} size="sm" />
                                </span>
                                <span className="flex min-w-0 flex-1 flex-col">
                                  <span className="text-sm font-medium text-fg">
                                    {title}
                                  </span>
                                  <span className="text-xs text-fg-subtle">
                                    {detail}
                                  </span>
                                </span>
                                <Icon
                                  name="chevron-right"
                                  size="sm"
                                  className="mt-1 text-fg-subtle"
                                />
                              </Link>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </Card>
                </div>
              </>
            );
          }}
        </QueryState>

        <Card as="section" padding="none" aria-labelledby="top-tenants-title">
          <CardHeader
            title={t('tenantsTitle')}
            titleId="top-tenants-title"
            inset
            actions={
              <Link
                href={routes.companies()}
                className="inline-flex items-center gap-1 text-sm text-primary hover:text-primary-hover"
              >
                {t('allTenants')}
                <Icon name="chevron-right" size="sm" />
              </Link>
            }
          />
          <QueryState query={tenants}>
            {(data) => (
              <ul className="m-0 flex list-none flex-col p-0">
                {data.items.map((tenant) => (
                  <li
                    key={tenant.id}
                    className="flex flex-wrap items-center gap-4 border-t border-border px-(--ph-card-padding) py-3"
                  >
                    <Link
                      href={routes.company(tenant.id)}
                      className="flex min-w-0 flex-1 flex-col hover:text-primary"
                    >
                      <span className="font-medium">{tenant.name}</span>
                      <span className="text-xs text-fg-subtle">
                        {tenant.city} · {tenant.owner.fullName}
                      </span>
                    </Link>
                    <span className="text-sm text-fg-muted">
                      {t('storesSplit', {
                        cloud: tenant.cloudStores,
                        offline: tenant.offlineStores,
                      })}
                    </span>
                    <span className="text-sm text-fg-muted">
                      {tenant.paidUntil
                        ? t('paidUntil', {
                            date: formatDateOnly(tenant.paidUntil),
                          })
                        : '—'}
                    </span>
                    <TenantStatusPill tenant={tenant} />
                    <span className="min-w-16 text-end text-sm font-bold tabular-nums">
                      {formatMoney(tenant.monthlyChargeMinor)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </QueryState>
        </Card>
      </div>
    </>
  );
}
