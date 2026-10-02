'use client';

import {
  actionsOf,
  permissionModules,
  specialPermissions,
  type Permission,
  type PermissionModule,
} from '@pharmacy/shared-domain';
import type { Role } from '@pharmacy/shared-dto';
import { Alert, Button, Checkbox, Dialog, TextField } from '@pharmacy/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslations } from 'use-intl';
import { apiRequest, useApiErrorMessage } from '@/shared/api';

const ACTIONS = [
  'view',
  'create',
  'update',
  'post',
  'unpost',
  'delete',
  'receive',
  'export',
] as const;

/** «pos:sell-controlled» → «pos_sell-controlled»: i18n keys have no dots or colons. */
export const permissionKey = (permission: string) =>
  permission.replace(':', '_');

/**
 * Role constructor (UI mockup «Конструктор роли», ADR-0018): the catalog of permissions as a matrix
 * «модуль × действие» plus special permissions. A permission the editor does not have is shown but
 * cannot be granted (no escalation); a system role is read only.
 */
export function RoleDialog({
  role,
  editorPermissions,
  canManage,
  onClose,
}: {
  role: Role | null;
  editorPermissions: readonly Permission[];
  canManage: boolean;
  onClose: () => void;
}) {
  const t = useTranslations('employees.role');
  const tEmp = useTranslations('employees');
  const queryClient = useQueryClient();
  const [name, setName] = useState(role?.name ?? '');
  const [granted, setGranted] = useState<Set<Permission>>(
    () => new Set(role?.permissions ?? []),
  );
  const [touched, setTouched] = useState(false);
  const own = new Set(editorPermissions);
  const editable = canManage && !role?.system;
  const save = useMutation({
    mutationFn: () => {
      const body = { name, permissions: [...granted] };
      return role
        ? apiRequest('roles.update', { params: { id: role.id }, body })
        : apiRequest('roles.create', { body });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['roles'] });
      onClose();
    },
  });
  const error = useApiErrorMessage(save.error);
  const toggle = (permission: Permission, on: boolean) =>
    setGranted((current) => {
      const next = new Set(current);
      if (on) next.add(permission);
      else next.delete(permission);
      return next;
    });
  const box = (permission: Permission, label: string) => (
    <Checkbox
      label={<span className="ph-visually-hidden">{label}</span>}
      checked={granted.has(permission)}
      disabled={!editable || (!own.has(permission) && !granted.has(permission))}
      onChange={(event) => toggle(permission, event.target.checked)}
    />
  );
  const moduleName = (module: PermissionModule) =>
    t(`modules.${module}` as 'modules.pos');

  return (
    <Dialog
      open
      onClose={onClose}
      title={role ? role.name : t('newTitle')}
      description={role?.system ? t('systemHint') : t('subtitle')}
      closeLabel={tEmp('close')}
      size="xl"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {tEmp('cancel')}
          </Button>
          {editable && (
            <Button
              loading={save.isPending}
              onClick={() => {
                setTouched(true);
                if (name.trim()) save.mutate();
              }}
            >
              {tEmp('save')}
            </Button>
          )}
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {error && (
          <Alert tone="danger" live="assertive">
            {error}
          </Alert>
        )}
        <TextField
          label={t('name')}
          required
          disabled={!editable}
          value={name}
          error={touched && !name.trim() ? t('nameRequired') : undefined}
          onChange={(event) => setName(event.target.value)}
        />
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <caption className="text-start text-sm font-bold">
              {t('matrix')}
            </caption>
            <thead className="bg-(--ph-table-header-bg) text-xs text-fg-muted">
              <tr>
                <th scope="col" className="px-2 py-2 text-start font-medium">
                  {t('module')}
                </th>
                {ACTIONS.map((action) => (
                  <th
                    key={action}
                    scope="col"
                    className="px-2 py-2 text-center font-medium"
                  >
                    {t(`actions.${action}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {permissionModules.map((module) => (
                <tr key={module} className="border-b border-border">
                  <th scope="row" className="px-2 py-1 text-start font-medium">
                    {moduleName(module)}
                  </th>
                  {ACTIONS.map((action) => (
                    <td key={action} className="px-2 py-1">
                      <div className="flex justify-center">
                        {actionsOf(module).includes(action)
                          ? box(
                              `${module}:${action}` as Permission,
                              `${moduleName(module)} — ${t(`actions.${action}`)}`,
                            )
                          : null}
                      </div>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 text-sm font-bold">{t('specials')}</legend>
          <div className="grid grid-cols-2 gap-2">
            {specialPermissions.map((permission) => (
              <Checkbox
                key={permission}
                label={t(
                  `special.${permissionKey(permission)}` as 'special.finance_view-cost',
                )}
                checked={granted.has(permission)}
                disabled={
                  !editable ||
                  (!own.has(permission) && !granted.has(permission))
                }
                onChange={(event) => toggle(permission, event.target.checked)}
              />
            ))}
          </div>
        </fieldset>
        <p className="text-xs text-fg-subtle">{t('escalationHint')}</p>
        <p className="text-xs text-fg-subtle">{t('scopeHint')}</p>
      </div>
    </Dialog>
  );
}
