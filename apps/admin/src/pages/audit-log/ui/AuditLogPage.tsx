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
  StatusPill,
  TextField,
  type DataTableColumn,
  type StatusTone,
} from '@pharmacy/ui';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslations } from 'use-intl';
import { apiRequest } from '@/shared/api';
import { QueryState } from '@/shared/ui';
import { PageHeader } from '@/widgets/app-shell';

const PAGE = 20;
const types: OperatorActionType[] = [
  'company',
  'payment',
  'key',
  'service',
  'impersonation',
  'settings',
];
const typeTone: Record<OperatorActionType, StatusTone> = {
  company: 'info',
  payment: 'success',
  key: 'warning',
  service: 'info',
  impersonation: 'attention',
  settings: 'neutral',
};

function monthStart(): string {
  return `${toAppDate().slice(0, 7)}-01`;
}

/** Operators' audit log (UI mockup «Журнал»): append-only, read only, kept for at least 3 years. */
export function AuditLogPage() {
  const t = useTranslations('auditLog');
  const tTable = useTranslations('table');
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
    queryKey: ['operator-audit', operatorId, type, from, to, offset],
    queryFn: ({ signal }) =>
      apiRequest('operatorAudit.list', {
        query: {
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
      cell: (row) => row.operatorName,
    },
    {
      key: 'type',
      header: t('columns.type'),
      nowrap: true,
      cell: (row) => (
        <StatusPill tone={typeTone[row.type]} icon={null}>
          {t(`types.${row.type}`)}
        </StatusPill>
      ),
    },
    {
      key: 'target',
      header: t('columns.target'),
      cell: (row) => row.targetLabel,
    },
    {
      key: 'description',
      header: t('columns.description'),
      cell: (row) => row.description,
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
            {types.map((value) => (
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
