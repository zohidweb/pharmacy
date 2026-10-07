'use client';

import type {
  EmployeeCard,
  EmployeeListItem,
  EmployeeStatus,
  Role,
  TenantTerminal,
} from '@pharmacy/shared-dto';
import { formatDateOnly, formatDateTime } from '@pharmacy/shared-util';
import {
  Alert,
  Button,
  Card,
  CardHeader,
  DataTable,
  Icon,
  Pagination,
  Select,
  StatusPill,
  Tabs,
  type DataTableColumn,
} from '@pharmacy/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslations } from 'use-intl';
import { can, canWrite, useSession } from '@/entities/session';
import { apiRequest, useApiErrorMessage, withFreshAuth } from '@/shared/api';
import { WithMessages } from '@/shared/i18n';
import { QueryState } from '@/shared/ui';
import { PageHeader } from '@/widgets/app-shell';
import { EmployeeDialog } from './EmployeeDialog';
import { RoleDialog, permissionKey } from './RoleDialog';

type Tab = 'employees' | 'roles' | 'terminals';
const PAGE = 20;

function useRoles() {
  return useQuery({
    queryKey: ['roles'],
    queryFn: ({ signal }) => apiRequest('roles.list', { signal }),
  });
}

function EmployeesTab() {
  const t = useTranslations('employees');
  const { data: session } = useSession();
  const [storeId, setStoreId] = useState('');
  const [roleId, setRoleId] = useState('');
  const [status, setStatus] = useState<EmployeeStatus | ''>('');
  const [offset, setOffset] = useState(0);
  const [editing, setEditing] = useState<EmployeeCard | 'new' | null>(null);
  const roles = useRoles();
  const settings = useQuery({
    queryKey: ['settings'],
    queryFn: ({ signal }) => apiRequest('settings.get', { signal }),
    enabled: can(session, 'settings:view'),
  });
  const list = useQuery({
    queryKey: ['employees', 'list', storeId, roleId, status, offset],
    queryFn: ({ signal }) =>
      apiRequest('employees.list', {
        query: {
          storeId: storeId || undefined,
          roleId: roleId || undefined,
          status: status || undefined,
          limit: PAGE,
          offset,
        },
        signal,
      }),
  });
  const open = useMutation({
    mutationFn: (id: string) => apiRequest('employees.get', { params: { id } }),
    onSuccess: setEditing,
  });
  const openError = useApiErrorMessage(open.error);
  const canEdit = canWrite(session, 'employees:update');

  const columns: DataTableColumn<EmployeeListItem>[] = [
    {
      key: 'name',
      header: t('columns.name'),
      cell: (row) =>
        canEdit ? (
          <button
            type="button"
            onClick={() => open.mutate(row.id)}
            className="min-h-touch text-start font-bold text-primary underline"
          >
            {row.fullName}
          </button>
        ) : (
          <b>{row.fullName}</b>
        ),
    },
    {
      key: 'login',
      header: t('columns.login'),
      cell: (row) => (
        <div className="flex flex-col">
          <span>{row.login}</span>
          <span className="text-xs whitespace-nowrap text-fg-subtle">
            {row.phone}
          </span>
        </div>
      ),
    },
    { key: 'role', header: t('columns.role'), cell: (row) => row.roleName },
    {
      key: 'stores',
      header: t('columns.stores'),
      cell: (row) =>
        row.storeIds === null ? t('allStores') : row.storeNames.join(', '),
    },
    {
      key: 'locale',
      header: t('columns.locale'),
      cell: (row) => row.locale.toUpperCase(),
    },
    {
      key: 'status',
      header: t('columns.status'),
      cell: (row) =>
        row.status === 'active' ? (
          <StatusPill tone="success">{t('statuses.active')}</StatusPill>
        ) : (
          <StatusPill tone="danger">{t('statuses.blocked')}</StatusPill>
        ),
    },
    {
      key: 'lastLogin',
      header: t('columns.lastLogin'),
      nowrap: true,
      cell: (row) => (row.lastLoginAt ? formatDateTime(row.lastLoginAt) : '—'),
    },
  ];

  return (
    <Card padding="none">
      <CardHeader
        title={t('staff')}
        inset
        actions={
          <div className="flex flex-wrap gap-2">
            <Select
              label={t('columns.stores')}
              hideLabel
              value={storeId}
              onChange={(event) => {
                setStoreId(event.target.value);
                setOffset(0);
              }}
              options={[
                { value: '', label: t('allStores') },
                ...(session?.stores ?? []).map((s) => ({
                  value: s.id,
                  label: s.name,
                })),
              ]}
            />
            <Select
              label={t('columns.role')}
              hideLabel
              value={roleId}
              onChange={(event) => {
                setRoleId(event.target.value);
                setOffset(0);
              }}
              options={[
                { value: '', label: t('allRoles') },
                ...(roles.data ?? []).map((r) => ({
                  value: r.id,
                  label: r.name,
                })),
              ]}
            />
            <Select
              label={t('columns.status')}
              hideLabel
              value={status}
              onChange={(event) => {
                setStatus(event.target.value as EmployeeStatus | '');
                setOffset(0);
              }}
              options={[
                { value: '', label: t('allStatuses') },
                { value: 'active', label: t('statuses.active') },
                { value: 'blocked', label: t('statuses.blocked') },
              ]}
            />
            <Button
              iconStart="user-plus"
              disabled={!canWrite(session, 'employees:create') || !roles.data}
              onClick={() => setEditing('new')}
            >
              {t('new')}
            </Button>
          </div>
        }
      />
      {openError && (
        <div className="px-(--ph-card-padding) pb-3">
          <Alert tone="danger" live="assertive">
            {openError}
          </Alert>
        </div>
      )}
      <QueryState query={list}>
        {(data) => (
          <>
            <DataTable
              caption={t('staff')}
              rowKey={(row) => row.id}
              rows={data.items}
              columns={columns}
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
      {editing && roles.data && (
        <EmployeeDialog
          key={editing === 'new' ? 'new' : editing.id}
          employee={editing === 'new' ? null : editing}
          roles={roles.data}
          minPinLength={settings.data?.minPinLength ?? 4}
          onClose={() => setEditing(null)}
        />
      )}
    </Card>
  );
}

const SPECIAL_SHOWN = [
  'pos:sell-controlled',
  'returns:without-receipt',
  'pos:choose-batch',
  'pricing:update-network',
  'pricing:update-store',
  'finance:view-cost',
] as const;

function RolesTab() {
  const t = useTranslations('employees');
  const tRole = useTranslations('employees.role');
  const { data: session } = useSession();
  const roles = useRoles();
  const [editing, setEditing] = useState<Role | 'new' | null>(null);
  const canManage = canWrite(session, 'roles:manage');
  const columns: DataTableColumn<Role>[] = [
    {
      key: 'name',
      header: t('columns.role'),
      cell: (row) => (
        <button
          type="button"
          onClick={() => setEditing(row)}
          className="min-h-touch text-start font-bold text-primary underline"
        >
          {row.name}
        </button>
      ),
    },
    {
      key: 'type',
      header: t('roleType'),
      cell: (row) =>
        row.system ? (
          <span className="inline-flex items-center gap-1 text-fg-muted">
            <Icon name="lock" size="sm" />
            {t('systemRole')}
          </span>
        ) : (
          t('customRole')
        ),
    },
    {
      key: 'specials',
      header: tRole('specials'),
      cell: (row) => {
        const shown = SPECIAL_SHOWN.filter((p) => row.permissions.includes(p));
        return shown.length === 0 ? (
          '—'
        ) : (
          <div className="flex flex-wrap gap-1">
            {shown.map((p) => (
              <StatusPill key={p} tone="neutral" icon={null}>
                {tRole(
                  `special.${permissionKey(p)}` as 'special.finance_view-cost',
                )}
              </StatusPill>
            ))}
          </div>
        );
      },
    },
    {
      key: 'permissions',
      header: t('permissionsCount'),
      numeric: true,
      cell: (row) => row.permissions.length,
    },
    {
      key: 'employees',
      header: t('employeesCount'),
      numeric: true,
      cell: (row) => row.employees,
    },
  ];
  return (
    <QueryState query={roles}>
      {(data) => (
        <Card padding="none">
          <CardHeader
            title={t('roles')}
            description={t('rolesHint')}
            inset
            actions={
              <Button
                iconStart="plus"
                disabled={!canManage}
                onClick={() => setEditing('new')}
              >
                {tRole('newTitle')}
              </Button>
            }
          />
          <DataTable
            caption={t('roles')}
            rowKey={(row) => row.id}
            rows={data}
            columns={columns}
          />
          {editing && (
            <RoleDialog
              key={editing === 'new' ? 'new' : editing.id}
              role={editing === 'new' ? null : editing}
              editorPermissions={session?.permissions ?? []}
              canManage={
                canManage &&
                (editing === 'new' || editing.id !== session?.role.id)
              }
              onClose={() => setEditing(null)}
            />
          )}
        </Card>
      )}
    </QueryState>
  );
}

function TerminalsTab() {
  const t = useTranslations('employees.terminals');
  const { data: session } = useSession();
  const queryClient = useQueryClient();
  const terminals = useQuery({
    queryKey: ['terminals'],
    queryFn: ({ signal }) => apiRequest('terminals.list', { signal }),
  });
  const unbind = useMutation({
    mutationFn: (id: string) =>
      withFreshAuth(() => apiRequest('terminals.unbind', { params: { id } })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['terminals'] }),
  });
  const error = useApiErrorMessage(unbind.error);
  const canUnbind =
    canWrite(session, 'terminals:delete') && session?.auth === 'password';
  const columns: DataTableColumn<TenantTerminal>[] = [
    {
      key: 'device',
      header: t('device'),
      cell: (row) => (
        <div className="flex flex-col">
          <b>{row.name}</b>
          <span className="text-xs text-fg-subtle">
            {row.serial}
            {row.storeOffline ? ` · ${t('offline')}` : ''}
          </span>
        </div>
      ),
    },
    { key: 'store', header: t('store'), cell: (row) => row.storeName },
    { key: 'boundBy', header: t('boundBy'), cell: (row) => row.boundByName },
    {
      key: 'boundAt',
      header: t('boundAt'),
      nowrap: true,
      cell: (row) => formatDateOnly(row.boundAt.slice(0, 10)),
    },
    {
      key: 'actions',
      header: <span className="ph-visually-hidden">{t('actions')}</span>,
      cell: (row) =>
        canUnbind ? (
          <Button
            variant="secondary"
            loading={unbind.isPending && unbind.variables === row.id}
            aria-label={t('unbindOf', { name: row.name })}
            onClick={() => unbind.mutate(row.id)}
          >
            {t('unbind')}
          </Button>
        ) : null,
    },
  ];
  return (
    <QueryState query={terminals}>
      {(data) => (
        <Card padding="none">
          <CardHeader title={t('title')} description={t('hint')} inset />
          {error && (
            <div className="px-(--ph-card-padding) pb-3">
              <Alert tone="danger" live="assertive">
                {error}
              </Alert>
            </div>
          )}
          <DataTable
            caption={t('title')}
            rowKey={(row) => row.id}
            rows={data}
            columns={columns}
          />
        </Card>
      )}
    </QueryState>
  );
}

/** Employees, roles and terminals (UI mockup «Сотрудники и роли»). */
function EmployeesPageView() {
  const t = useTranslations('employees');
  const { data: session } = useSession();
  const [tab, setTab] = useState<Tab>('employees');
  const items = [
    {
      value: 'employees' as const,
      label: t('tabs.employees'),
      panel: <EmployeesTab />,
    },
    ...(can(session, 'roles:view')
      ? [
          {
            value: 'roles' as const,
            label: t('tabs.roles'),
            panel: <RolesTab />,
          },
        ]
      : []),
    ...(can(session, 'terminals:view')
      ? [
          {
            value: 'terminals' as const,
            label: t('tabs.terminals'),
            panel: <TerminalsTab />,
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

export function EmployeesPage() {
  return (
    <WithMessages groups={['owner']}>
      <EmployeesPageView />
    </WithMessages>
  );
}
