'use client';

import type {
  OperatorActionType,
  OperatorAuditEntry,
} from '@pharmacy/shared-dto';
import { formatDateTime, toAppDate } from '@pharmacy/shared-util';
import {
  Button,
  Card,
  Chip,
  ChipGroup,
  DataTable,
  EmptyState,
  Pagination,
  Spinner,
  StatusPill,
  TextField,
  type DataTableColumn,
} from '@pharmacy/ui';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { useTranslations } from 'use-intl';
import {
  operatorActionTone,
  operatorActionTypes,
  useOperatorAuditText,
} from '@/entities/operator-audit';
import { useTenant } from '@/entities/tenant';
import { apiRequest, isOfflineSectionAvailable } from '@/shared/api';
import { routes } from '@/shared/config';
import { QueryState } from '@/shared/ui';
import { PageHeader } from '@/widgets/app-shell';

const PAGE = 20;

function monthStart(): string {
  return `${toAppDate().slice(0, 7)}-01`;
}

/**
 * Operators' audit log (UI mockup «Журнал»): append-only, read only, kept for at least 3 years.
 * `?tenantId=` narrows it to one company (the link from the company card).
 */
function AuditLogView() {
  const t = useTranslations('auditLog');
  const tTable = useTranslations('table');
  const router = useRouter();
  const tenantId = useSearchParams()?.get('tenantId') ?? '';
  const tenant = useTenant(tenantId);
  const text = useOperatorAuditText();
  const [operatorId, setOperatorId] = useState<string | undefined>(undefined);
  const [type, setType] = useState<OperatorActionType | undefined>(undefined);
  const [from, setFrom] = useState(() => {
    const [year, month] = toAppDate().split('-').map(Number);
    return new Date(Date.UTC(year, month - 2, 1)).toISOString().slice(0, 10);
  });
  const [to, setTo] = useState(toAppDate());
  const [offset, setOffset] = useState(0);
  const operators = useQuery({
    queryKey: ['operators'],
    queryFn: ({ signal }) => apiRequest('operators.list', { signal }),
  });
  const log = useQuery({
    queryKey: ['operator-audit', tenantId, operatorId, type, from, to, offset],
    queryFn: ({ signal }) =>
      apiRequest('operatorAudit.list', {
        query: {
          tenantId: tenantId || undefined,
          operatorId,
          type,
          from: from || undefined,
          to: to || undefined,
          limit: PAGE,
          offset,
        },
        signal,
      }),
    placeholderData: keepPreviousData,
  });
  const reset = () => {
    setOperatorId(undefined);
    setType(undefined);
    setFrom(monthStart());
    setTo(toAppDate());
    setOffset(0);
  };

  const columns: DataTableColumn<OperatorAuditEntry>[] = [
    {
      key: 'at',
      header: t('columns.at'),
      nowrap: true,
      cell: (row) => formatDateTime(row.at),
    },
    {
      key: 'operator',
      header: t('columns.operator'),
      cell: (row) => text.actor(row),
    },
    {
      key: 'type',
      header: t('columns.type'),
      nowrap: true,
      cell: (row) => (
        <StatusPill tone={operatorActionTone[row.type]} icon={null}>
          {t(`types.${row.type}`)}
        </StatusPill>
      ),
    },
    {
      key: 'target',
      header: t('columns.target'),
      cell: (row) => text.target(row),
    },
    {
      key: 'description',
      header: t('columns.description'),
      cell: (row) => text.describe(row),
    },
  ];

  return (
    <>
      <PageHeader title={t('title')} subtitle={t('subtitle')} />
      <div className="flex flex-col gap-4 p-6">
        <Card className="flex flex-col gap-4">
          <div className="grid grid-cols-4 items-end gap-4">
            <TextField
              label={t('from')}
              type="date"
              max={to}
              value={from}
              onChange={(event) => {
                setFrom(event.target.value);
                setOffset(0);
              }}
            />
            <TextField
              label={t('to')}
              type="date"
              min={from}
              value={to}
              onChange={(event) => {
                setTo(event.target.value);
                setOffset(0);
              }}
            />
          </div>
          {tenantId && (
            <ChipGroup label={t('types.company')}>
              <Chip
                selected={false}
                onClick={() => {
                  setOffset(0);
                  router.replace(routes.auditLog());
                }}
              >
                {t('allCompanies')}
              </Chip>
              <Chip selected>
                {t('companyFilter', { name: tenant.data?.name ?? '…' })}
              </Chip>
            </ChipGroup>
          )}
          <ChipGroup label={t('operatorLabel')}>
            <Chip
              selected={operatorId === undefined}
              onClick={() => setOperatorId(undefined)}
            >
              {t('allOperators')}
            </Chip>
            {(operators.data ?? []).map((operator) => (
              <Chip
                key={operator.id}
                selected={operatorId === operator.id}
                onClick={() => {
                  setOperatorId(operator.id);
                  setOffset(0);
                }}
              >
                {operator.fullName}
              </Chip>
            ))}
          </ChipGroup>
          <ChipGroup label={t('typeLabel')}>
            <Chip
              selected={type === undefined}
              onClick={() => setType(undefined)}
            >
              {t('allTypes')}
            </Chip>
            {operatorActionTypes
              .filter((value) => value !== 'key' || isOfflineSectionAvailable())
              .map((value) => (
                <Chip
                  key={value}
                  selected={type === value}
                  onClick={() => {
                    setType(value);
                    setOffset(0);
                  }}
                >
                  {t(`types.${value}`)}
                </Chip>
              ))}
          </ChipGroup>
        </Card>
        <QueryState query={log}>
          {(page) => (
            <Card padding="none">
              <DataTable
                caption={t('title')}
                columns={columns}
                rows={page.items}
                rowKey={(row) => row.id}
                minWidth="lg"
                empty={
                  <EmptyState
                    icon="scroll-text"
                    title={t('empty')}
                    action={
                      <Button variant="tertiary" onClick={reset}>
                        {t('reset')}
                      </Button>
                    }
                  />
                }
              />
              {page.total > PAGE && (
                <Pagination
                  className="p-4"
                  offset={offset}
                  limit={PAGE}
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
              <p className="border-t border-border px-(--ph-table-cell-padding-x) py-3 text-xs text-fg-subtle">
                {t('note')}
              </p>
            </Card>
          )}
        </QueryState>
      </div>
    </>
  );
}

export function AuditLogPage() {
  return (
    <Suspense
      fallback={
        <div className="grid min-h-dvh place-items-center text-primary">
          <Spinner size="xl" />
        </div>
      }
    >
      <AuditLogView />
    </Suspense>
  );
}
