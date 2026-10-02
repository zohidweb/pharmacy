'use client';

import type { AuditAction, TenantAuditEntry } from '@pharmacy/shared-dto';
import {
  formatDateOnly,
  formatDateTime,
  toAppDate,
} from '@pharmacy/shared-util';
import {
  Avatar,
  Button,
  Card,
  DataTable,
  EmptyState,
  Icon,
  Pagination,
  Select,
  TextField,
  type DataTableColumn,
} from '@pharmacy/ui';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslations } from 'use-intl';
import { can, useSession } from '@/entities/session';
import { apiRequest } from '@/shared/api';
import { WithMessages } from '@/shared/i18n';
import { QueryState } from '@/shared/ui';
import { PageHeader } from '@/widgets/app-shell';

const PAGE = 20;
const ACTIONS: AuditAction[] = [
  'sale',
  'return',
  'goods_receipt',
  'transfer',
  'write_off',
  'stock_count',
  'price_change',
  'sign_in',
  'shift_open',
  'employee_block',
  'password_reset',
  'role_change',
  'unpost',
  'settings_change',
];

const daysAgo = (days: number) =>
  toAppDate(new Date(Date.now() - days * 86_400_000));

/** Audit log (UI mockup «Журнал действий»): append-only, read only. */
function AuditLogPageView() {
  const t = useTranslations('auditLog');
  const tActions = useTranslations('employees.auditActions');
  const { data: session } = useSession();
  const [from, setFrom] = useState(() => daysAgo(30));
  const [to, setTo] = useState(toAppDate);
  const [employeeId, setEmployeeId] = useState('');
  const [storeId, setStoreId] = useState('');
  const [action, setAction] = useState<AuditAction | ''>('');
  const [q, setQ] = useState('');
  const [offset, setOffset] = useState(0);
  const employees = useQuery({
    queryKey: ['employees', 'list', 'audit'],
    queryFn: ({ signal }) =>
      apiRequest('employees.list', { query: { limit: 100 }, signal }),
    enabled: can(session, 'employees:view'),
  });
  const list = useQuery({
    queryKey: ['audit-log', from, to, employeeId, storeId, action, q, offset],
    queryFn: ({ signal }) =>
      apiRequest('auditLog.list', {
        query: {
          from: from || undefined,
          to: to || undefined,
          employeeId: employeeId || undefined,
          storeId: storeId || undefined,
          action: action || undefined,
          q: q || undefined,
          limit: PAGE,
          offset,
        },
        signal,
      }),
    placeholderData: (previous) => previous,
  });
  const reset =
    <T,>(set: (value: T) => void) =>
    (value: T) => {
      set(value);
      setOffset(0);
    };

  const columns: DataTableColumn<TenantAuditEntry>[] = [
    {
      key: 'at',
      header: t('at'),
      nowrap: true,
      cell: (row) => (
        <div className="flex flex-col">
          <span>{formatDateTime(row.at)}</span>
          {row.documentDate && (
            <span className="text-xs text-fg-subtle">
              {t('backdated', { date: formatDateOnly(row.documentDate) })}
            </span>
          )}
        </div>
      ),
    },
    {
      key: 'employee',
      header: t('employee'),
      cell: (row) => (
        <span className="inline-flex items-center gap-2">
          <Avatar name={row.employeeName} size="sm" />
          {row.employeeName}
        </span>
      ),
    },
    {
      key: 'store',
      header: t('store'),
      cell: (row) => row.storeName ?? t('network'),
    },
    {
      key: 'action',
      header: t('action'),
      cell: (row) => tActions(row.action),
    },
    { key: 'object', header: t('object'), cell: (row) => row.object },
    { key: 'details', header: t('details'), cell: (row) => row.details },
    {
      key: 'source',
      header: t('source'),
      cell: (row) =>
        row.byOperator ? (
          <span className="inline-flex items-center gap-1 text-xs font-medium text-attention">
            <Icon name="user-check" size="sm" />
            {t('operator')}
          </span>
        ) : null,
    },
  ];

  return (
    <>
      <PageHeader
        title={t('title')}
        subtitle={t('subtitle')}
        actions={
          <Button
            variant="secondary"
            iconStart="download"
            disabled
            aria-describedby="audit-excel-pending"
          >
            {t('excel')}
          </Button>
        }
      />
      <div className="flex flex-col gap-4 px-6 pt-4">
        <p id="audit-excel-pending" className="text-xs text-fg-subtle">
          {t('excelPending')}
        </p>
        <Card padding="none">
          <div className="flex flex-wrap items-end gap-3 p-(--ph-card-padding)">
            <TextField
              label={t('from')}
              type="date"
              max={to}
              value={from}
              onChange={(event) => reset(setFrom)(event.target.value)}
            />
            <TextField
              label={t('to')}
              type="date"
              min={from}
              value={to}
              onChange={(event) => reset(setTo)(event.target.value)}
            />
            {employees.data && (
              <Select
                label={t('employee')}
                value={employeeId}
                onChange={(event) => reset(setEmployeeId)(event.target.value)}
                options={[
                  { value: '', label: t('allEmployees') },
                  ...employees.data.items.map((e) => ({
                    value: e.id,
                    label: e.fullName,
                  })),
                ]}
              />
            )}
            {(session?.stores.length ?? 0) > 1 && (
              <Select
                label={t('store')}
                value={storeId}
                onChange={(event) => reset(setStoreId)(event.target.value)}
                options={[
                  { value: '', label: t('allStores') },
                  ...(session?.stores ?? []).map((s) => ({
                    value: s.id,
                    label: s.name,
                  })),
                ]}
              />
            )}
            <Select
              label={t('action')}
              value={action}
              onChange={(event) =>
                reset(setAction)(event.target.value as AuditAction | '')
              }
              options={[
                { value: '', label: t('allActions') },
                ...ACTIONS.map((value) => ({
                  value,
                  label: tActions(value),
                })),
              ]}
            />
            <TextField
              label={t('search')}
              type="search"
              placeholder={t('searchPlaceholder')}
              value={q}
              onChange={(event) => reset(setQ)(event.target.value)}
            />
          </div>
          <QueryState query={list}>
            {(data) => (
              <>
                <DataTable
                  caption={t('title')}
                  rowKey={(row) => row.id}
                  rows={data.items}
                  columns={columns}
                  empty={<EmptyState icon="scroll-text" title={t('empty')} />}
                />
                {data.total > PAGE && (
                  <Pagination
                    className="px-4 py-3"
                    total={data.total}
                    limit={PAGE}
                    offset={offset}
                    onOffsetChange={setOffset}
                    labels={{
                      nav: t('pagination'),
                      previous: t('previous'),
                      next: t('next'),
                      range: (range) => t('shown', range),
                    }}
                  />
                )}
              </>
            )}
          </QueryState>
        </Card>
      </div>
    </>
  );
}

export function AuditLogPage() {
  return (
    <WithMessages groups={['owner']}>
      <AuditLogPageView />
    </WithMessages>
  );
}
