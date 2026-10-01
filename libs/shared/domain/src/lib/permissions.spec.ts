import {
  actionsOf,
  exceedingPermissions,
  hasPermissions,
  isPermission,
  permissionModules,
  permissions,
  specialPermissions,
} from './permissions';
import { roleTemplates } from './role-templates';

describe('permission catalog', () => {
  it('has unique `<module>:<action>` entries', () => {
    expect(new Set(permissions).size).toBe(permissions.length);
    for (const permission of permissions) {
      expect(permission).toMatch(/^[a-z0-9-]+:[a-z-]+$/);
    }
  });

  it('covers the modules of ADR-0018', () => {
    expect(permissionModules).toEqual([
      'pos',
      'shifts',
      'returns',
      'inventory',
      'purchasing',
      'catalog',
      'pricing',
      'discounts',
      'reports',
      'export-1c',
      'employees',
      'roles',
      'terminals',
      'stores',
      'services',
      'billing',
      'audit',
      'settings',
      'sync',
    ]);
    expect(actionsOf('inventory')).toContain('unpost');
    expect(specialPermissions).toContain('finance:view-cost');
  });

  it('recognizes only catalog strings', () => {
    expect(isPermission('inventory:post')).toBe(true);
    expect(isPermission('inventory:fly')).toBe(false);
    expect(isPermission(42)).toBe(false);
  });

  it('checks a granted set', () => {
    const granted = ['pos:view', 'pos:create'] as const;
    expect(hasPermissions(granted, 'pos:view', 'pos:create')).toBe(true);
    expect(hasPermissions(granted, 'pos:view', 'returns:create')).toBe(false);
  });

  it('reports permissions above the editor own set (no escalation)', () => {
    expect(
      exceedingPermissions(
        ['pos:view', 'roles:manage'],
        ['pos:view', 'finance:view-cost', 'finance:view-cost'],
      ),
    ).toEqual(['finance:view-cost']);
  });
});

describe('role templates', () => {
  it('give the owner the whole catalog as a system role', () => {
    expect(roleTemplates.owner.permissions).toEqual(permissions);
    expect(roleTemplates.owner.system).toBe(true);
  });

  it('use catalog permissions only, without duplicates', () => {
    for (const template of Object.values(roleTemplates)) {
      expect(template.permissions.every(isPermission)).toBe(true);
      expect(new Set(template.permissions).size).toBe(
        template.permissions.length,
      );
    }
  });

  it('keep the cashier away from cost and controlled sales', () => {
    const cashier = roleTemplates.cashier.permissions;
    expect(cashier).not.toContain('finance:view-cost');
    expect(cashier).not.toContain('pos:sell-controlled');
    expect(
      exceedingPermissions(
        roleTemplates.manager.permissions,
        roleTemplates.cashier.permissions,
      ),
    ).toEqual([]);
  });

  it('keep the accountant read-only on stock', () => {
    expect(roleTemplates.accountant.permissions).not.toContain(
      'inventory:post',
    );
  });
});
