'use client';

import type { Supplier, SupplierListItem } from '@pharmacy/shared-dto';
import { formatDateOnly, formatMoney } from '@pharmacy/shared-util';
import {
  Alert,
  Button,
  Card,
  CardHeader,
  DataTable,
  EmptyState,
  KpiTile,
  Pagination,
  type DataTableColumn,
} from '@pharmacy/ui';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslations } from 'use-intl';
import { DebtStatePill } from '@/entities/purchasing';
import { can, canWrite, useSession } from '@/entities/session';
import { apiRequest } from '@/shared/api';
import { QueryState } from '@/shared/ui';
import { PageHeader } from '@/widgets/app-shell';
import {
  PaymentDialog,
  SupplierCardDialog,
  SupplierFormDialog,
} from './SupplierDialogs';

const PAGE = 10;

type Paying = { id: string; name: string; debtMinor?: number };

/** Suppliers and debts (UI mockup «Поставщики и долги»): TJS only, no exchange differences. */
export function SuppliersPage() {
  const t = useTranslations('suppliers');
  const tDocs = useTranslations('stockDocs');
  const { data: session } = useSession();
  const canSeeCost = can(session, 'finance:view-cost');
  const canPay = canWrite(session, 'purchasing:post') && canSeeCost;
  const canCreate = canWrite(session, 'purchasing:create');
  const canEdit = canWrite(session, 'purchasing:update');
  const [offset, setOffset] = useState(0);
  const [editing, setEditing] = useState<Supplier | 'new' | null>(null);
  const [cardId, setCardId] = useState<string | null>(null);
  const [paying, setPaying] = useState<Paying | null>(null);

  const list = useQuery({
    queryKey: ['suppliers', 'list', offset],
    queryFn: ({ signal }) =>
      apiRequest('suppliers.list', {
        query: { limit: PAGE, offset },
        signal,
      }),
  });

  const columns: DataTableColumn<SupplierListItem>[] = [
    {
      key: 'name',
      header: t('supplier'),
      cell: (row) => (
        <div className="flex flex-col">
          {canSeeCost ? (
            <button
              type="button"
              onClick={() => setCardId(row.id)}
              className="min-h-touch text-start font-bold text-primary underline"
            >
              {row.name}
            </button>
          ) : (
            <b>{row.name}</b>
          )}
          <span className="text-xs text-fg-subtle">
            {[row.phone, row.taxId && t('taxIdShort', { taxId: row.taxId })]
              .filter(Boolean)
              .join(' · ')}
          </span>
        </div>
      ),
    },
    ...(canSeeCost
      ? [
          {
            key: 'debt',
            header: t('debtHeader'),
            numeric: true,
            nowrap: true,
            cell: (row: SupplierListItem) =>
              formatMoney(row.debtMinor ?? 0, { withSign: false }),
          },
        ]
      : []),
    {
      key: 'due',
      header: t('payByHeader'),
      nowrap: true,
      cell: (row) => (row.nextDueOn ? formatDateOnly(row.nextDueOn) : '—'),
    },
    {
      key: 'state',
      header: tDocs('statusHeader'),
      cell: (row) => (
        <DebtStatePill state={row.debtState} overdueDays={row.overdueDays} />
      ),
    },
    {
      key: 'actions',
      header: <span className="ph-visually-hidden">{tDocs('actions')}</span>,
      cell: (row) =>
        canPay && (row.debtMinor ?? 0) > 0 ? (
          <Button
            variant="secondary"
            iconStart="wallet"
            onClick={() => setPaying(row)}
          >
            {t('pay')}
          </Button>
        ) : null,
    },
  ];

  return (
    <>
      <PageHeader
        title={t('title')}
        actions={
          <Button
            iconStart="plus"
            disabled={!canCreate}
            onClick={() => setEditing('new')}
          >
            {t('new')}
          </Button>
        }
      />
      <div className="flex flex-col gap-4 px-6 pt-4">
        {session?.impersonation && (
          <Alert tone="info">{tDocs('notices.impersonation')}</Alert>
        )}
        {!canSeeCost && <Alert tone="info">{t('costHidden')}</Alert>}
        <QueryState query={list}>
          {(data) => (
            <>
              {data.totals && (
                <div className="grid grid-cols-3 gap-4">
                  <KpiTile
                    label={t('kpi.debt')}
                    value={formatMoney(data.totals.debtMinor)}
                    icon="wallet"
                  />
                  <KpiTile
                    label={t('kpi.overdue')}
                    value={formatMoney(data.totals.overdueMinor)}
                    hint={
                      data.totals.overdueMinor > 0
                        ? t('kpi.overdueHint')
                        : t('kpi.noOverdue')
                    }
                    tone={data.totals.overdueMinor > 0 ? 'danger' : 'default'}
                    icon="clock"
                  />
                </div>
              )}
              <Card padding="none">
                <CardHeader title={t('list')} inset />
                <DataTable
                  caption={t('list')}
                  rowKey={(row) => row.id}
                  rows={data.items}
                  columns={columns}
                  empty={<EmptyState icon="truck" title={t('empty')} />}
                />
                <p className="px-(--ph-card-padding) py-3 text-xs text-fg-subtle">
                  {t('tjsHint')}
                </p>
                {data.total > PAGE && (
                  <Pagination
                    className="px-4 py-3"
                    total={data.total}
                    limit={PAGE}
                    offset={offset}
                    onOffsetChange={setOffset}
                    labels={{
                      nav: t('pagination'),
                      previous: tDocs('previous'),
                      next: tDocs('next'),
                      range: (range) => tDocs('shown', range),
                    }}
                  />
                )}
              </Card>
            </>
          )}
        </QueryState>
      </div>
      {editing && (
        <SupplierFormDialog
          supplier={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
      {cardId && (
        <SupplierCardDialog
          supplierId={cardId}
          canPay={canPay}
          canEdit={canEdit}
          onClose={() => setCardId(null)}
          onPay={(card) => {
            setCardId(null);
            setPaying(card);
          }}
          onEdit={(card) => {
            setCardId(null);
            setEditing(card);
          }}
        />
      )}
      {paying && (
        <PaymentDialog supplier={paying} onClose={() => setPaying(null)} />
      )}
    </>
  );
}
