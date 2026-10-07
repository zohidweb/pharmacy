import {
  exceedingPermissions,
  permissions as catalog,
  type Permission,
  scopeWithin,
} from '@pharmacy/shared-domain';

/** A store scope: null — the whole network, otherwise the stores. */
export type Scope = readonly string[] | null;

/** The one who edits: own permissions, scope and whether the role is «Владелец». */
export interface Editor {
  employeeId: string;
  permissions: readonly Permission[];
  scope: Scope;
  isOwner: boolean;
}

/** A role as the rules see it; the owner role holds every permission of the catalog. */
export interface RoleFacts {
  isOwner: boolean;
  permissions: readonly Permission[];
}

export const permissionsOf = (role: RoleFacts): readonly Permission[] =>
  role.isOwner ? catalog : role.permissions;

/** The session scope ('all' or ids) as a rule scope. */
export const scopeOf = (storeScope: 'all' | readonly string[]): Scope =>
  storeScope === 'all' ? null : storeScope;

/**
 * Visibility (spec 2026-10-06-staff-design, section 4): an employee is visible when the scopes
 * meet; a whole-network employee only to a whole-network viewer.
 */
export function isVisible(viewer: Scope, employee: Scope): boolean {
  if (viewer === null) return true;
  if (employee === null) return false;
  return employee.some((storeId) => viewer.includes(storeId));
}

/**
 * ADR-0018, п. 4 — the role is not above the editor: its permissions are the editor's own, and
 * «Владелец» is given or touched only by an owner. Returns false on escalation.
 */
export function roleWithinEditor(editor: Editor, role: RoleFacts): boolean {
  if (role.isOwner && !editor.isOwner) return false;
  return exceedingPermissions(editor.permissions, permissionsOf(role)).length === 0;
}

/** ADR-0018, п. 4 — the assigned scope lies within the editor's scope. */
export function scopeWithinEditor(editor: Editor, assigned: Scope): boolean {
  return scopeWithin(editor.scope, assigned);
}

/** Two scopes are the same assignment (order of the stores does not matter). */
export function sameScope(a: Scope, b: Scope): boolean {
  if (a === null || b === null) return a === b;
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((storeId) => set.has(storeId));
}
