/*
 * Role templates copied into every new tenant (ADR-0018, п. 2). After the copy the tenant edits its
 * roles freely; changes here do not reach existing tenants. «Владелец» is a system role: always the
 * whole catalog and the whole network, not editable.
 */
import { permissions, type Permission } from './permissions';

export type RoleTemplateKey = 'owner' | 'manager' | 'cashier' | 'accountant';

export interface RoleTemplate {
  key: RoleTemplateKey;
  /** Default store scope of employees with this role. */
  scope: 'network' | 'stores';
  system: boolean;
  permissions: readonly Permission[];
}

const cashier: Permission[] = [
  'pos:view',
  'pos:create',
  'shifts:view',
  'shifts:create',
  'shifts:update',
  'returns:view',
  'returns:create',
  'inventory:view',
  'catalog:view',
  'pricing:view',
];

const manager: Permission[] = [
  ...cashier,
  'pos:sell-controlled',
  'pos:choose-batch',
  'returns:without-receipt',
  'inventory:create',
  'inventory:update',
  'inventory:post',
  'inventory:unpost',
  'inventory:delete',
  'inventory:receive',
  'inventory:export',
  'purchasing:view',
  'purchasing:create',
  'purchasing:update',
  'purchasing:post',
  'purchasing:delete',
  'purchasing:export',
  'catalog:create',
  'catalog:update',
  'catalog:export',
  'pricing:update-store',
  'discounts:view',
  'discounts:manage-store',
  'finance:view-cost',
  'reports:view',
  'reports:export',
  'employees:view',
  'employees:create',
  'employees:update',
  'employees:assign-role',
  'roles:view',
  'terminals:view',
  'terminals:create',
  'terminals:delete',
  'stores:view',
  'audit:view',
  'settings:view',
  'sync:view',
  'sync:run',
];

const accountant: Permission[] = [
  'inventory:view',
  'inventory:export',
  'purchasing:view',
  'purchasing:export',
  'catalog:view',
  'pricing:view',
  'finance:view-cost',
  'reports:view',
  'reports:export',
  'export-1c:view',
  'export-1c:export',
  'stores:view',
  'audit:view',
  'audit:export',
];

export const roleTemplates: Readonly<Record<RoleTemplateKey, RoleTemplate>> =
  {
    owner: { key: 'owner', scope: 'network', system: true, permissions },
    manager: {
      key: 'manager',
      scope: 'stores',
      system: false,
      permissions: manager,
    },
    cashier: {
      key: 'cashier',
      scope: 'stores',
      system: false,
      permissions: cashier,
    },
    accountant: {
      key: 'accountant',
      scope: 'network',
      system: false,
      permissions: accountant,
    },
  };
