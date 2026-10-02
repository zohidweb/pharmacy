'use client';

import {
  checkPin,
  passwordProblems,
  type PasswordRule,
} from '@pharmacy/shared-domain';
import type {
  CreateEmployeeRequest,
  EmployeeCard,
  EmployeeActivityEntry,
  Role,
  UiLocale,
} from '@pharmacy/shared-dto';
import { formatDateTime } from '@pharmacy/shared-util';
import {
  Alert,
  Button,
  Checkbox,
  DataTable,
  Dialog,
  Select,
  TextField,
  useToast,
  type DataTableColumn,
} from '@pharmacy/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslations } from 'use-intl';
import { useSession } from '@/entities/session';
import { apiRequest, useApiErrorMessage } from '@/shared/api';

type Form = CreateEmployeeRequest;

const formOf = (employee: EmployeeCard | null, roleId: string): Form => ({
  fullName: employee?.fullName ?? '',
  phone: employee?.phone ?? '',
  login: employee?.login ?? '',
  password: '',
  pin: '',
  roleId: employee?.roleId ?? roleId,
  storeIds: employee ? employee.storeIds : [],
  locale: employee?.locale ?? 'ru',
});

/**
 * New employee or the employee card (UI mockups «Новый сотрудник», «Карточка сотрудника»):
 * one role and a store scope (ADR-0018); a role or stores above the editor's own are not offered.
 */
export function EmployeeDialog({
  employee,
  roles,
  minPinLength,
  onClose,
}: {
  employee: EmployeeCard | null;
  roles: Role[];
  minPinLength: number;
  onClose: () => void;
}) {
  const t = useTranslations('employees.dialog');
  const tEmp = useTranslations('employees');
  const toast = useToast();
  const queryClient = useQueryClient();
  const { data: session } = useSession();
  const own = new Set(session?.permissions ?? []);
  const assignable = roles.filter(
    (r) =>
      r.permissions.every((p) => own.has(p)) &&
      (!r.system || session?.role.system),
  );
  const [form, setForm] = useState<Form>(() =>
    formOf(employee, assignable.find((r) => !r.system)?.id ?? ''),
  );
  const [card, setCard] = useState(employee);
  const [touched, setTouched] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const self = employee?.id === session?.employee.id;
  const role = roles.find((r) => r.id === form.roleId);
  const network = role?.system ?? false;
  const scopeStores = session?.stores ?? [];
  const canNetworkScope = session?.scope === 'network';

  const invalid = {
    fullName: form.fullName.trim() === '',
    login: !/^[a-z0-9._-]{3,32}$/.test(form.login.trim().toLowerCase()),
    password: !employee && passwordProblems(form.password).length > 0,
    pin:
      !employee && form.pin !== '' && checkPin(form.pin, minPinLength) !== null,
    stores: !network && form.storeIds !== null && form.storeIds.length === 0,
  };
  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ['employees'] });
  const save = useMutation({
    mutationFn: () => {
      const body = { ...form, storeIds: network ? null : form.storeIds };
      if (!employee) return apiRequest('employees.create', { body });
      const { password: _p, pin: _n, ...update } = body;
      return apiRequest('employees.update', {
        params: { id: employee.id },
        body: update,
      });
    },
    onSuccess: () => {
      void invalidate();
      onClose();
    },
  });
  const reset = useMutation({
    mutationFn: () =>
      apiRequest('employees.resetPassword', {
        params: { id: employee?.id ?? '' },
        body: { newPassword },
      }),
    onSuccess: () => {
      setNewPassword('');
      toast.show(t('passwordReset'));
    },
  });
  const status = useMutation({
    mutationFn: () =>
      apiRequest('employees.setStatus', {
        params: { id: employee?.id ?? '' },
        body: { status: card?.status === 'blocked' ? 'active' : 'blocked' },
      }),
    onSuccess: (next) => {
      setCard(next);
      void invalidate();
    },
  });
  const error = useApiErrorMessage(save.error ?? reset.error ?? status.error);
  const set = <K extends keyof Form>(key: K, value: Form[K]) =>
    setForm((current) => ({ ...current, [key]: value }));
  const rules = (value: string): PasswordRule[] => passwordProblems(value);

  const activityColumns: DataTableColumn<EmployeeActivityEntry>[] = [
    {
      key: 'at',
      header: t('at'),
      nowrap: true,
      cell: (row) => formatDateTime(row.at),
    },
    {
      key: 'action',
      header: t('action'),
      cell: (row) => tEmp(`auditActions.${row.action}`),
    },
    { key: 'object', header: t('object'), cell: (row) => row.object },
    { key: 'details', header: t('details'), cell: (row) => row.details },
  ];

  return (
    <Dialog
      open
      onClose={onClose}
      title={employee ? employee.fullName : t('newTitle')}
      description={
        employee
          ? [
              employee.roleName,
              employee.storeNames.join(', ') || tEmp('allStores'),
              employee.lastLoginAt
                ? t('lastLogin', { at: formatDateTime(employee.lastLoginAt) })
                : null,
            ]
              .filter(Boolean)
              .join(' · ')
          : t('subtitle')
      }
      closeLabel={tEmp('close')}
      size="lg"
      footer={
        <>
          {employee && !self && (
            <Button
              variant={card?.status === 'blocked' ? 'success' : 'destructive'}
              iconStart={card?.status === 'blocked' ? 'user-check' : 'ban'}
              loading={status.isPending}
              onClick={() => status.mutate()}
            >
              {card?.status === 'blocked' ? t('unblock') : t('block')}
            </Button>
          )}
          <Button variant="secondary" onClick={onClose}>
            {tEmp('cancel')}
          </Button>
          <Button
            loading={save.isPending}
            onClick={() => {
              setTouched(true);
              if (!Object.values(invalid).some(Boolean)) save.mutate();
            }}
          >
            {tEmp('save')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        {error && (
          <Alert tone="danger" live="assertive">
            {error}
          </Alert>
        )}
        {card?.status === 'blocked' && (
          <Alert tone="warning">{t('blockedHint')}</Alert>
        )}
        <div className="grid grid-cols-2 gap-4">
          <TextField
            label={t('fullName')}
            required
            value={form.fullName}
            error={touched && invalid.fullName ? t('required') : undefined}
            onChange={(event) => set('fullName', event.target.value)}
          />
          <TextField
            label={t('phone')}
            type="tel"
            value={form.phone}
            onChange={(event) => set('phone', event.target.value)}
          />
          <TextField
            label={t('login')}
            required
            autoComplete="off"
            value={form.login}
            hint={t('loginHint')}
            error={touched && invalid.login ? t('loginFormat') : undefined}
            onChange={(event) => set('login', event.target.value)}
          />
          <Select
            label={t('locale')}
            value={form.locale}
            onChange={(event) => set('locale', event.target.value as UiLocale)}
            options={(['ru', 'tg'] as const).map((value) => ({
              value,
              label: value.toUpperCase(),
            }))}
          />
          {!employee && (
            <>
              <TextField
                label={t('password')}
                type="password"
                required
                autoComplete="new-password"
                value={form.password}
                hint={t('passwordHint')}
                error={
                  touched && invalid.password
                    ? rules(form.password)
                        .map((rule) => t(`passwordRules.${rule}`))
                        .join(', ')
                    : undefined
                }
                onChange={(event) => set('password', event.target.value)}
              />
              <TextField
                label={t('pin', { min: minPinLength })}
                type="password"
                inputMode="numeric"
                autoComplete="off"
                value={form.pin}
                hint={t('pinHint')}
                error={touched && invalid.pin ? t('pinInvalid') : undefined}
                onChange={(event) =>
                  set('pin', event.target.value.replace(/\D/g, ''))
                }
              />
            </>
          )}
          <Select
            label={t('role')}
            value={form.roleId}
            disabled={self}
            hint={self ? t('ownRoleHint') : undefined}
            onChange={(event) => set('roleId', event.target.value)}
            options={roles
              .filter(
                (r) => assignable.includes(r) || r.id === employee?.roleId,
              )
              .map((r) => ({ value: r.id, label: r.name }))}
          />
        </div>
        <fieldset className="flex flex-col gap-2" disabled={self}>
          <legend className="mb-2 text-sm font-bold">{t('stores')}</legend>
          {network ? (
            <p className="text-sm text-fg-muted">{t('ownerScope')}</p>
          ) : (
            <>
              {canNetworkScope && (
                <Checkbox
                  label={tEmp('allStores')}
                  checked={form.storeIds === null}
                  onChange={(event) =>
                    set('storeIds', event.target.checked ? null : [])
                  }
                />
              )}
              {form.storeIds !== null && (
                <div className="grid grid-cols-2 gap-2">
                  {scopeStores.map((store) => (
                    <Checkbox
                      key={store.id}
                      label={store.name}
                      checked={form.storeIds?.includes(store.id) ?? false}
                      onChange={(event) =>
                        set(
                          'storeIds',
                          event.target.checked
                            ? [...(form.storeIds ?? []), store.id]
                            : (form.storeIds ?? []).filter(
                                (id) => id !== store.id,
                              ),
                        )
                      }
                    />
                  ))}
                </div>
              )}
              {touched && invalid.stores && (
                <Alert tone="warning">{t('storesRequired')}</Alert>
              )}
            </>
          )}
        </fieldset>
        {employee && (
          <section className="flex flex-col gap-2">
            <h3 className="text-sm font-bold">{t('resetTitle')}</h3>
            <div className="grid grid-cols-(--ph-search-columns) items-start gap-3">
              <TextField
                label={t('newPassword')}
                hideLabel
                type="password"
                autoComplete="new-password"
                placeholder={t('newPassword')}
                value={newPassword}
                error={
                  newPassword && rules(newPassword).length > 0
                    ? rules(newPassword)
                        .map((rule) => t(`passwordRules.${rule}`))
                        .join(', ')
                    : undefined
                }
                onChange={(event) => setNewPassword(event.target.value)}
              />
              <Button
                variant="secondary"
                iconStart="key-round"
                loading={reset.isPending}
                disabled={!newPassword || rules(newPassword).length > 0}
                onClick={() => reset.mutate()}
              >
                {t('resetPassword')}
              </Button>
            </div>
            <p className="text-xs text-fg-subtle">{t('resetHint')}</p>
          </section>
        )}
        {employee && (
          <DataTable
            caption={t('activity')}
            rowKey={(row) => `${row.at}-${row.object}`}
            rows={employee.activity}
            columns={activityColumns}
          />
        )}
      </div>
    </Dialog>
  );
}
