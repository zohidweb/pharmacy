'use client';

import {
  formatDateOnly,
  formatDateTime,
  formatMoney,
  formatPercentBp,
  formatPeriod,
} from '@pharmacy/shared-util';
import { Alert, Avatar, Card, Icon, Spinner, Tabs } from '@pharmacy/ui';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { useTranslations } from 'use-intl';
import { TenantStatusPill, useTenant } from '@/entities/tenant';
import { RecordPayment } from '@/features/record-payment';
import { routes } from '@/shared/config';
import { QueryState } from '@/shared/ui';
import { PageHeader } from '@/widgets/app-shell';
import { BlockTenant } from './BlockTenant';
import { EditTenant } from './EditTenant';
import { IssueOwnerCode } from './IssueOwnerCode';
import { BillingTab, ServicesTab, StatsTab, StoresTab } from './CompanyTabs';

// No log tab: the actions of the employees of the network stay with its owner (ADR-0013 §5); the operators' actions
// on it open from the link «Действия операторов» above (spec 2026-10-23-admin-store-card-tenant-log, A7).
type Tab = 'stores' | 'billing' | 'services' | 'stats';

function CompanyView() {
  const t = useTranslations('company');
  const id = useSearchParams()?.get('id') ?? '';
  const tenant = useTenant(id);
  const [tab, setTab] = useState<Tab>('stores');

  return (
    <>
      <PageHeader
        title={tenant.data?.name ?? t('title')}
        subtitle={t('subtitle')}
      />
      <div className="flex flex-col gap-4 p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <Link
            href={routes.companies()}
            className="inline-flex items-center gap-1 text-sm text-primary hover:text-primary-hover"
          >
            <Icon name="arrow-left" size="sm" />
            {t('back')}
          </Link>
          {id && (
            <Link
              href={routes.companyAuditLog(id)}
              className="inline-flex items-center gap-1 text-sm text-primary hover:text-primary-hover"
            >
              <Icon name="scroll-text" size="sm" />
              {t('operatorActions')}
            </Link>
          )}
        </div>
        <QueryState query={tenant}>
          {(company) => (
            <>
              <Card className="flex flex-wrap items-center gap-5">
                <Avatar name={company.name} size="lg" />
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-xl font-bold tracking-tight">
                      {company.name}
                    </h2>
                    <TenantStatusPill tenant={company} />
                  </div>
                  <p className="text-sm text-fg-muted">
                    {t('meta', {
                      owner: company.owner.fullName,
                      phone: company.owner.phone,
                      city: company.city,
                      since: formatDateOnly(company.joinedOn),
                    })}
                  </p>
                  <p className="text-xs text-fg-subtle">
                    {t('inn', { inn: company.inn })}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <EditTenant tenant={company} />
                  <RecordPayment tenantId={company.id} variant="tertiary" />
                  <IssueOwnerCode tenant={company} />
                  <BlockTenant tenant={company} />
                </div>
              </Card>
              <dl className="m-0 grid grid-cols-4 gap-3">
                {(
                  [
                    ['debt', formatMoney(company.debtMinor)],
                    ['overdueDebt', formatMoney(company.overdueDebtMinor)],
                    ['advance', formatMoney(company.advanceMinor)],
                    [
                      'discount',
                      company.discount
                        ? t('summary.discountValue', {
                            percent: formatPercentBp(
                              company.discount.percentBp,
                            ),
                            month: formatPeriod(company.discount.toMonth),
                          })
                        : t('summary.noDiscount'),
                    ],
                  ] as const
                ).map(([key, value]) => (
                  <div
                    key={key}
                    className="flex flex-col rounded-md bg-surface p-3"
                  >
                    <dt className="text-xs text-fg-subtle">
                      {t(`summary.${key}`)}
                    </dt>
                    <dd
                      className={
                        key === 'overdueDebt' && company.overdue
                          ? 'm-0 text-lg font-bold tabular-nums text-danger'
                          : 'm-0 text-lg font-bold tabular-nums'
                      }
                    >
                      {value}
                    </dd>
                  </div>
                ))}
              </dl>
              {company.block && (
                <Alert tone="danger" title={t('blockedTitle')}>
                  {t('blockedText', {
                    by: company.block.blockedBy,
                    at: formatDateTime(company.block.blockedAt),
                    reason: company.block.reason,
                  })}
                </Alert>
              )}
              <Tabs
                label={t('tabsLabel')}
                value={tab}
                onValueChange={setTab}
                items={[
                  {
                    value: 'stores',
                    label: t('tabs.stores'),
                    count: company.cloudStores + company.offlineStores,
                    panel: <StoresTab tenantId={company.id} />,
                  },
                  {
                    value: 'billing',
                    label: t('tabs.billing'),
                    panel: <BillingTab tenantId={company.id} />,
                  },
                  {
                    value: 'services',
                    label: t('tabs.services'),
                    panel: (
                      <ServicesTab
                        tenantId={company.id}
                        tenantName={company.name}
                      />
                    ),
                  },
                  {
                    value: 'stats',
                    label: t('tabs.stats'),
                    panel: <StatsTab tenantId={company.id} />,
                  },
                ]}
              />
            </>
          )}
        </QueryState>
      </div>
    </>
  );
}

/** Company card (UI mockup «Компания»), `/companies/view?id=…` (static export, ADR-0015). */
export function CompanyPage() {
  return (
    <Suspense
      fallback={
        <div className="grid min-h-dvh place-items-center text-primary">
          <Spinner size="xl" />
        </div>
      }
    >
      <CompanyView />
    </Suspense>
  );
}
