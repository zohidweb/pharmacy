'use client';

import type { CashExpensesOfStore, Expense } from '@pharmacy/shared-dto';
import { formatMoney, toAppDate } from '@pharmacy/shared-util';
import {
  Alert,
  Button,
  Card,
  DataTable,
  Dialog,
  EmptyState,
  IconButton,
  Select,
  type DataTableColumn,
} from '@pharmacy/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useFormatter, useTranslations } from 'use-intl';
import { canWrite, useSession } from '@/entities/session';
import { apiRequest, useApiErrorMessage } from '@/shared/api';
import { WithMessages } from '@/shared/i18n';
import { QueryState } from '@/shared/ui';
import { PageHeader } from '@/widgets/app-shell';
import { ExpenseDialog } from './ExpenseDialog';

/** The month YYYY-MM moved by `delta` months. */
function shiftMonth(month: string, delta: number): string {
  const [year, number] = month.split('-').map(Number);
  const date = new Date(Date.UTC(year, number - 1 + delta, 1));
  return date.toISOString().slice(0, 7);
}

type Row = Expense | { id: 'total'; amountMinor: number };

/**
 * Other expenses (spec 2026-10-14-owner-cabinet, O4, O9, E16, 8 «PR 3»): the records of a month by
 * store or for the whole network, and the cash withdrawals «на расходы» of the month, read only.
 */
function ExpensesPageView() {
  const t = useTranslations('expenses');
  const kinds = useTranslations('expenseKinds');
  const format = useFormatter();
  const queryClient = useQueryClient();
  const { data: session } = useSession();
  const current = toAppDate().slice(0, 7);
  const [month, setMonth] = useState(current);
  const [storeId, setStoreId] = useState('');
  const [editing, setEditing] = useState<Expense | 'new' | null>(null);
  const [deleting, setDeleting] = useState<Expense | null>(null);
  const canCreate = canWrite(session, 'expenses:create');
  const canUpdate = canWrite(session, 'expenses:update');
  const canDelete = canWrite(session, 'expenses:delete');

  const list = useQuery({
    queryKey: ['expenses', month, storeId],
    queryFn: ({ signal }) =>
      apiRequest('expenses.list', {
        query: { month, storeId: storeId || undefined },
        signal,
      }),
  });
  const remove = useMutation({
    mutationFn: (expense: Expense) =>
      apiRequest('expenses.delete', { params: { id: expense.id } }),
    onSuccess: () => {
      setDeleting(null);
      void queryClient.invalidateQueries({ queryKey: ['expenses'] });
      void queryClient.invalidateQueries({ queryKey: ['reports'] });
    },
  });
  const removeError = useApiErrorMessage(remove.error);

  const [year, monthNumber] = month.split('-');
  const monthTitle = t('month', {
    month: t(`months.${Number(monthNumber)}` as 'months.1'),
    year,
  });
  const storeOf = (expense: Expense) => expense.storeName ?? t('network');

  const columns: DataTableColumn<Row>[] = [
    {
      key: 'store',
      header: t('store'),
      cell: (row) => ('kind' in row ? storeOf(row) : t('total')),
    },
    {
      key: 'kind',
      header: t('kind'),
      cell: (row) => ('kind' in row ? kinds(row.kind) : ''),
    },
    {
      key: 'amount',
      header: t('amount'),
      numeric: true,
      nowrap: true,
      cell: (row) => formatMoney(row.amountMinor, { withSign: false }),
    },
    {
      key: 'comment',
      header: t('comment'),
      cell: (row) => ('kind' in row ? (row.comment ?? '—') : ''),
    },
    ...(canUpdate || canDelete
      ? [
          {
            key: 'actions',
            header: t('actions'),
            cell: (row: Row) =>
              'kind' in row ? (
                <div className="flex gap-1">
                  {canUpdate && (
                    <IconButton
                      icon="pencil"
                      variant="ghost"
                      label={`${t('edit')}: ${storeOf(row)}, ${kinds(row.kind)}`}
                      onClick={() => setEditing(row)}
                    />
                  )}
                  {canDelete && (
                    <IconButton
                      icon="delete"
                      variant="ghost"
                      label={`${t('delete')}: ${storeOf(row)}, ${kinds(row.kind)}`}
                      onClick={() => {
                        remove.reset();
                        setDeleting(row);
                      }}
                    />
                  )}
                </div>
              ) : null,
          },
        ]
      : []),
  ];
  const cashColumns: DataTableColumn<CashExpensesOfStore>[] = [
    { key: 'store', header: t('store'), cell: (row) => row.storeName },
    {
      key: 'operations',
      header: t('cashOperations'),
      numeric: true,
      cell: (row) => format.number(row.operations),
    },
    {
      key: 'amount',
      header: t('amount'),
      numeric: true,
      nowrap: true,
      cell: (row) => formatMoney(row.amountMinor, { withSign: false }),
    },
  ];

  return (
    <>
      <PageHeader
        title={t('title')}
        subtitle={t('subtitle')}
        actions={
          canCreate && (
            <Button iconStart="plus" onClick={() => setEditing('new')}>
              {t('add')}
            </Button>
          )
        }
      />
      <div className="flex flex-col gap-4 px-6 pt-4 pb-6">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex items-center gap-2">
            <IconButton
              icon="chevron-left"
              variant="surface"
              label={t('prevMonth')}
              onClick={() => setMonth(shiftMonth(month, -1))}
            />
            <h2 className="min-w-40 text-center text-lg font-bold" aria-live="polite">
              {monthTitle}
            </h2>
            <IconButton
              icon="chevron-right"
              variant="surface"
              label={t('nextMonth')}
              disabled={month >= current}
              onClick={() => setMonth(shiftMonth(month, 1))}
            />
          </div>
          {(session?.stores.length ?? 0) > 1 && (
            <Select
              label={t('store')}
              value={storeId}
              onChange={(event) => setStoreId(event.target.value)}
              options={[
                { value: '', label: t('allStores') },
                ...(session?.stores ?? []).map((store) => ({
                  value: store.id,
                  label: store.name,
                })),
              ]}
            />
          )}
        </div>
        <QueryState query={list}>
          {(data) => (
            <>
              <Card padding="none">
                <DataTable
                  caption={`${t('title')} · ${monthTitle}`}
                  rowKey={(row) => row.id}
                  rows={
                    data.items.length === 0
                      ? []
                      : [
                          ...data.items,
                          { id: 'total' as const, amountMinor: data.totalMinor },
                        ]
                  }
                  columns={columns}
                  empty={<EmptyState icon="wallet" title={t('empty')} />}
                />
              </Card>
              <Card padding="none">
                <div className="flex flex-col gap-1 p-(--ph-card-padding)">
                  <h2 className="text-lg font-bold">{t('cashTitle')}</h2>
                  <p className="text-sm text-fg-muted">{t('cashHint')}</p>
                </div>
                <DataTable
                  caption={t('cashTitle')}
                  rowKey={(row) => row.storeId}
                  rows={data.cashExpenses}
                  columns={cashColumns}
                  empty={<EmptyState icon="banknote" title={t('cashEmpty')} />}
                />
              </Card>
            </>
          )}
        </QueryState>
      </div>
      {editing && (
        <ExpenseDialog
          expense={editing === 'new' ? null : editing}
          month={month}
          onClose={() => setEditing(null)}
        />
      )}
      {deleting && (
        <Dialog
          open
          onClose={() => setDeleting(null)}
          title={t('deleteTitle')}
          description={t('deleteText', {
            kind: kinds(deleting.kind),
            store: storeOf(deleting),
            amount: formatMoney(deleting.amountMinor, { withSign: false }),
          })}
          closeLabel={t('cancel')}
          icon="delete"
          tone="danger"
          size="sm"
          footer={
            <>
              <Button variant="secondary" onClick={() => setDeleting(null)}>
                {t('cancel')}
              </Button>
              <Button
                variant="destructive"
                loading={remove.isPending}
                disabled={remove.isPending}
                onClick={() => remove.mutate(deleting)}
              >
                {t('delete')}
              </Button>
            </>
          }
        >
          {removeError && <Alert tone="danger">{removeError}</Alert>}
        </Dialog>
      )}
    </>
  );
}

export function ExpensesPage() {
  return (
    <WithMessages groups={['owner']}>
      <ExpensesPageView />
    </WithMessages>
  );
}
