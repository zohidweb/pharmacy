'use client';

import type {
  LicenseListFilter,
  LicenseListItem,
  LicenseSortKey,
  LicenseTermChoice,
  SyncSchedule,
} from '@pharmacy/shared-dto';
import { daysBetween, formatDateOnly, toAppDate } from '@pharmacy/shared-util';
import {
  Alert,
  Button,
  Card,
  Chip,
  ChipGroup,
  DataTable,
  Dialog,
  EmptyState,
  Select,
  TextareaField,
  TextField,
  useToast,
  type DataTableColumn,
  type SortState,
} from '@pharmacy/ui';
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { useFormatter, useTranslations } from 'use-intl';
import { LicenseStatusPill, licenseStatusKey } from '@/entities/license';
import { storeKeys, SYNC_STALE_DAYS } from '@/entities/store';
import { tenantKeys } from '@/entities/tenant';
import { apiRequest, useApiErrorMessage } from '@/shared/api';
import { routes } from '@/shared/config';
import { QueryState } from '@/shared/ui';
import { PageHeader } from '@/widgets/app-shell';

const filters: LicenseListFilter[] = ['all', 'expiring', 'inactive'];
const terms: LicenseTermChoice[] = ['week', 'quarter', 'year', 'custom'];
const schedules: SyncSchedule[] = ['daily', 'twice_daily', 'hourly', 'manual'];
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Issue (license = null) or renew a key; the server generates the code. */
function LicenseDialog({
  open,
  license,
  onClose,
}: {
  open: boolean;
  license: LicenseListItem | null;
  onClose: () => void;
}) {
  const t = useTranslations('licenses.dialog');
  const tSchedule = useTranslations('store.license.scheduleValue');
  const tCommon = useTranslations('common');
  const toast = useToast();
  const queryClient = useQueryClient();
  const today = toAppDate();
  const [storeId, setStoreId] = useState('');
  const [term, setTerm] = useState<LicenseTermChoice>('year');
  const [customDate, setCustomDate] = useState('');
  const [notifyDays, setNotifyDays] = useState('7');
  const [schedule, setSchedule] = useState<SyncSchedule>('daily');
  const [touched, setTouched] = useState(false);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const key = open ? (license?.id ?? 'new') : null;
  if (key !== loadedFor) {
    setLoadedFor(key);
    setStoreId('');
    setTerm('year');
    setCustomDate('');
    setNotifyDays(String(license?.notifyDaysBefore ?? 7));
    setSchedule(license?.syncSchedule ?? 'daily');
    setTouched(false);
  }
  const options = useQuery({
    queryKey: ['stores', 'offline-options'],
    queryFn: ({ signal }) => apiRequest('stores.offlineOptions', { signal }),
    enabled: open && !license,
  });
  const notify = Number(notifyDays);
  const errors = {
    store: !license && storeId === '',
    custom: term === 'custom' && (!DATE.test(customDate) || customDate < today),
    notify: !Number.isInteger(notify) || notify < 1 || notify > 60,
  };
  const invalid = errors.store || errors.custom || errors.notify;

  const save = useMutation({
    mutationFn: () => {
      const body = {
        term,
        ...(term === 'custom' && { validUntil: customDate }),
        notifyDaysBefore: notify,
        syncSchedule: schedule,
      };
      return license
        ? apiRequest('licenses.renew', { params: { id: license.id }, body })
        : apiRequest('licenses.issue', { body: { ...body, storeId } });
    },
    onSuccess: (saved) => {
      void queryClient.invalidateQueries({ queryKey: ['licenses'] });
      void queryClient.invalidateQueries({
        queryKey: storeKeys.detail(saved.storeId),
      });
      void queryClient.invalidateQueries({
        queryKey: tenantKeys.detail(saved.tenantId),
      });
      toast.show(
        license
          ? t('renewed', { date: formatDateOnly(saved.validUntil) })
          : t('issued', { code: saved.code }),
      );
      onClose();
    },
  });
  const error = useApiErrorMessage(save.error);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={license ? t('renewTitle') : t('issueTitle')}
      description={
        license
          ? `${license.storeName} · ${license.code}`
          : t('issueDescription')
      }
      closeLabel={tCommon('close')}
      size="md"
      footer={
        <>
          <Button variant="tertiary" onClick={onClose}>
            {tCommon('cancel')}
          </Button>
          <Button
            iconStart="key-round"
            loading={save.isPending}
            onClick={() => {
              setTouched(true);
              if (!invalid) save.mutate();
            }}
          >
            {license ? t('renew') : t('issue')}
          </Button>
        </>
      }
    >
      {error && (
        <Alert tone="danger" live="assertive">
          {error}
        </Alert>
      )}
      {!license && (
        <Select
          label={t('store')}
          placeholder={t('storePlaceholder')}
          required
          value={storeId}
          error={touched && errors.store ? t('storeRequired') : undefined}
          options={(options.data ?? []).map((option) => ({
            value: option.id,
            label: `${option.name} · ${option.tenantName}${option.hasActiveLicense ? ` (${t('hasKey')})` : ''}`,
            disabled: option.hasActiveLicense,
          }))}
          onChange={(event) => setStoreId(event.target.value)}
        />
      )}
      <ChipGroup label={t('term')}>
        {terms.map((value) => (
          <Chip
            key={value}
            selected={term === value}
            onClick={() => setTerm(value)}
          >
            {t(`terms.${value}`)}
          </Chip>
        ))}
      </ChipGroup>
      {term === 'custom' && (
        <TextField
          label={t('validUntil')}
          type="date"
          min={today}
          required
          value={customDate}
          error={touched && errors.custom ? t('validUntilError') : undefined}
          onChange={(event) => setCustomDate(event.target.value)}
        />
      )}
      <div className="grid grid-cols-2 gap-4">
        <TextField
          label={t('notifyDays')}
          inputMode="numeric"
          value={notifyDays}
          error={touched && errors.notify ? t('notifyDaysError') : undefined}
          onChange={(event) => setNotifyDays(event.target.value)}
        />
        <Select
          label={t('schedule')}
          value={schedule}
          options={schedules.map((value) => ({
            value,
            label: tSchedule(value),
          }))}
          onChange={(event) => setSchedule(event.target.value as SyncSchedule)}
        />
      </div>
      <Alert tone="info">{t('codeNote')}</Alert>
    </Dialog>
  );
}

function RevokeDialog({
  license,
  onClose,
}: {
  license: LicenseListItem | null;
  onClose: () => void;
}) {
  const t = useTranslations('licenses.revoke');
  const tCommon = useTranslations('common');
  const toast = useToast();
  const queryClient = useQueryClient();
  const [reason, setReason] = useState('');
  const revoke = useMutation({
    mutationFn: () =>
      apiRequest('licenses.revoke', {
        params: { id: license?.id ?? '' },
        body: { reason: reason.trim() },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['licenses'] });
      toast.show(t('done'));
      setReason('');
      onClose();
    },
  });
  const error = useApiErrorMessage(revoke.error);
  return (
    <Dialog
      open={license !== null}
      onClose={onClose}
      title={t('title')}
      description={
        license
          ? t('description', { store: license.storeName, code: license.code })
          : undefined
      }
      closeLabel={tCommon('close')}
      icon="triangle-alert"
      tone="danger"
      footer={
        <>
          <Button variant="tertiary" onClick={onClose}>
            {tCommon('cancel')}
          </Button>
          <Button
            variant="destructive"
            loading={revoke.isPending}
            disabled={reason.trim().length < 5}
            onClick={() => revoke.mutate()}
          >
            {t('confirm')}
          </Button>
        </>
      }
    >
      {error && (
        <Alert tone="danger" live="assertive">
          {error}
        </Alert>
      )}
      <TextareaField
        label={t('reason')}
        hint={t('reasonHint')}
        rows={2}
        required
        value={reason}
        onChange={(event) => setReason(event.target.value)}
      />
    </Dialog>
  );
}

/** «Лицензионные ключи» (UI mockup «Ключи»): keys of offline stores. */
export function LicensesPage() {
  const t = useTranslations('licenses');
  const tTable = useTranslations('table');
  const format = useFormatter();
  const today = toAppDate();
  const [filter, setFilter] = useState<LicenseListFilter>('all');
  const [sort, setSort] = useState<SortState<LicenseSortKey>>({
    key: 'validUntil',
    direction: 'asc',
  });
  const [dialog, setDialog] = useState<{
    license: LicenseListItem | null;
  } | null>(null);
  const [revoking, setRevoking] = useState<LicenseListItem | null>(null);
  const list = useQuery({
    queryKey: ['licenses', filter, sort],
    queryFn: ({ signal }) =>
      apiRequest('licenses.list', {
        query: { filter, sort: sort.key, direction: sort.direction },
        signal,
      }),
    placeholderData: keepPreviousData,
  });

  const columns: DataTableColumn<
    LicenseListItem,
    LicenseSortKey | 'code' | 'notify' | 'sync' | 'status' | 'actions'
  >[] = [
    {
      key: 'store',
      header: t('columns.store'),
      sortable: true,
      cell: (row) => (
        <div className="flex flex-col">
          <Link
            href={routes.store(row.storeId)}
            className="font-medium text-fg hover:text-primary"
          >
            {row.storeName}
          </Link>
          <span className="text-xs text-fg-subtle">{row.city}</span>
        </div>
      ),
    },
    {
      key: 'tenant',
      header: t('columns.tenant'),
      sortable: true,
      cell: (row) => row.tenantName,
    },
    {
      key: 'code',
      header: t('columns.code'),
      nowrap: true,
      cell: (row) => <span className="font-mono">{row.code}</span>,
    },
    {
      key: 'validUntil',
      header: t('columns.validUntil'),
      sortable: true,
      nowrap: true,
      cell: (row) => formatDateOnly(row.validUntil),
    },
    {
      key: 'notify',
      header: t('columns.notify'),
      nowrap: true,
      cell: (row) => t('notifyDays', { days: row.notifyDaysBefore }),
    },
    {
      key: 'sync',
      header: t('columns.sync'),
      nowrap: true,
      cell: (row) => {
        if (!row.lastSyncAt) return t('never');
        const stale =
          daysBetween(toAppDate(new Date(row.lastSyncAt)), today) >=
          SYNC_STALE_DAYS;
        return (
          <span className={stale ? 'font-medium text-warning' : undefined}>
            {format.relativeTime(new Date(row.lastSyncAt), new Date())}
          </span>
        );
      },
    },
    {
      key: 'status',
      header: t('columns.status'),
      nowrap: true,
      cell: (row) => <LicenseStatusPill license={row} />,
    },
    {
      key: 'actions',
      header: <span className="ph-visually-hidden">{tTable('actions')}</span>,
      align: 'end',
      nowrap: true,
      cell: (row) =>
        row.state === 'revoked' ? (
          <span className="text-xs text-fg-subtle">{row.revokeReason}</span>
        ) : (
          <div className="flex justify-end gap-1">
            <Button
              variant="tertiary"
              aria-label={t('renewFor', { code: row.code })}
              onClick={() => setDialog({ license: row })}
            >
              {t('renew')}
            </Button>
            {licenseStatusKey(row, today) !== 'expired' && (
              <Button
                variant="tertiary"
                aria-label={t('revokeFor', { code: row.code })}
                onClick={() => setRevoking(row)}
              >
                <span className="text-danger">{t('revokeAction')}</span>
              </Button>
            )}
          </div>
        ),
    },
  ];

  return (
    <>
      <PageHeader
        title={t('title')}
        subtitle={t('subtitle')}
        actions={
          <Button
            iconStart="key-round"
            onClick={() => setDialog({ license: null })}
          >
            {t('issue')}
          </Button>
        }
      />
      <div className="flex flex-col gap-4 p-6">
        <ChipGroup label={t('filterLabel')}>
          {filters.map((value) => (
            <Chip
              key={value}
              selected={filter === value}
              count={list.data?.counts[value]}
              onClick={() => setFilter(value)}
            >
              {t(`filters.${value}`)}
            </Chip>
          ))}
        </ChipGroup>
        <QueryState query={list}>
          {(data) => (
            <Card padding="none">
              <DataTable
                caption={t('title')}
                columns={columns}
                rows={data.items}
                rowKey={(row) => row.id}
                sort={sort}
                onSortChange={(next) =>
                  setSort(next as SortState<LicenseSortKey>)
                }
                sortLabel={(direction) => tTable(`sort.${direction}`)}
                minWidth="lg"
                empty={
                  <EmptyState
                    icon="key-round"
                    title={t('empty')}
                    action={
                      <Button
                        variant="tertiary"
                        onClick={() => setFilter('all')}
                      >
                        {t('showAll')}
                      </Button>
                    }
                  />
                }
              />
              <p className="border-t border-border px-(--ph-table-cell-padding-x) py-3 text-xs text-fg-subtle">
                {t('note')}
              </p>
            </Card>
          )}
        </QueryState>
      </div>
      <LicenseDialog
        open={dialog !== null}
        license={dialog?.license ?? null}
        onClose={() => setDialog(null)}
      />
      <RevokeDialog license={revoking} onClose={() => setRevoking(null)} />
    </>
  );
}
