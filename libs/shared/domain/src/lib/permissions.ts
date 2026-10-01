/*
 * Permission catalog of the client product (ADR-0018): a closed list of `<module>:<action>` strings
 * shared by apps/api (guards), apps/web and apps/admin. A new permission is a change here plus a
 * migration of the role templates. The server is the only source of truth for access decisions;
 * the frontends use permissions only to hide or disable UI.
 */

/** Actions available in each module. Not every module supports every action. */
const moduleActions = {
  pos: ['view', 'create'],
  shifts: ['view', 'create', 'update'],
  returns: ['view', 'create'],
  inventory: [
    'view',
    'create',
    'update',
    'post',
    'unpost',
    'delete',
    'receive',
    'export',
  ],
  purchasing: ['view', 'create', 'update', 'post', 'delete', 'export'],
  catalog: ['view', 'create', 'update', 'delete', 'export'],
  pricing: ['view'],
  discounts: ['view'],
  reports: ['view', 'export'],
  'export-1c': ['view', 'export'],
  employees: ['view', 'create', 'update', 'delete'],
  roles: ['view'],
  terminals: ['view', 'create', 'delete'],
  stores: ['view', 'create', 'update', 'delete'],
  services: ['view', 'create'],
  billing: ['view'],
  audit: ['view', 'export'],
  settings: ['view', 'update'],
  sync: ['view'],
} as const;

/** Special permissions that are not a plain module action (ADR-0018, п. 1). */
export const specialPermissions = [
  'pos:sell-controlled',
  'pos:choose-batch',
  'returns:without-receipt',
  'pricing:update-store',
  'pricing:update-network',
  'discounts:manage-store',
  'discounts:manage-network',
  'finance:view-cost',
  'roles:manage',
  'employees:assign-role',
  'sync:run',
] as const;

export type PermissionModule = keyof typeof moduleActions;

type ModulePermission = {
  [M in PermissionModule]: `${M}:${(typeof moduleActions)[M][number]}`;
}[PermissionModule];

export type SpecialPermission = (typeof specialPermissions)[number];
export type Permission = ModulePermission | SpecialPermission;

export const permissionModules = Object.keys(
  moduleActions,
) as PermissionModule[];

/** Every permission of the catalog in a stable order: module actions, then special permissions. */
export const permissions: readonly Permission[] = [
  ...permissionModules.flatMap((module) =>
    moduleActions[module].map(
      (action) => `${module}:${action}` as ModulePermission,
    ),
  ),
  ...specialPermissions,
];

const known = new Set<string>(permissions);

export function isPermission(value: unknown): value is Permission {
  return typeof value === 'string' && known.has(value);
}

/** Actions of one module, for the role editor «модуль × действие». */
export function actionsOf(module: PermissionModule): readonly string[] {
  return moduleActions[module];
}

/** True when every requested permission is in the granted set. */
export function hasPermissions(
  granted: Iterable<Permission>,
  ...required: Permission[]
): boolean {
  const set = granted instanceof Set ? granted : new Set(granted);
  return required.every((permission) => set.has(permission));
}

/**
 * Escalation check (ADR-0018, п. 4): a role being created or changed may contain only permissions
 * of the employee who changes it. Returns the permissions that exceed the editor's own.
 */
export function exceedingPermissions(
  editor: Iterable<Permission>,
  role: Iterable<Permission>,
): Permission[] {
  const own = new Set(editor);
  return [...new Set(role)].filter((permission) => !own.has(permission));
}
